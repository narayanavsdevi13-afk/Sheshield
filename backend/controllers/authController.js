const { createAuthClient } = require("../supabase");
const { clearAuthCookies, setSessionCookies } = require("../middleware/auth");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials(body, includeProfile) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return { error: "Password must be 8–72 bytes long." };
  }
  if (!includeProfile) return { email, password };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const digitCount = phone.replace(/\D/g, "").length;
  if (name.length < 2 || name.length > 70) return { error: "Name must be between 2 and 70 characters." };
  if (phone.length > 20 || digitCount < 7 || digitCount > 15) {
    return { error: "Enter a valid phone number with 7–15 digits." };
  }
  return { name, email, phone, password };
}

function publicUser(user) {
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    name: typeof metadata.name === "string" ? metadata.name : "",
    email: user.email,
    phone: typeof metadata.phone === "string" ? metadata.phone : ""
  };
}

function sendAuthError(error, response, next, isLogin) {
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  const status = Number(error.status);
  if (error.code === "user_already_exists" ||
      message.includes("already registered") ||
      message.includes("already been registered")) {
    return response.status(409).json({ error: "An account with this email already exists." });
  }
  if (isLogin && (status === 400 || status === 401 || error.code === "invalid_credentials")) {
    return response.status(401).json({ error: "Email or password is incorrect." });
  }
  if (!isLogin && (status === 400 || status === 422) &&
      (message.includes("password") || message.includes("email"))) {
    return response.status(400).json({ error: "Supabase Auth rejected the registration details. Check the email and password requirements." });
  }
  return next(error);
}

async function register(request, response, next) {
  const input = validateCredentials(request.body || {}, true);
  if (input.error) return response.status(400).json({ error: input.error });

  try {
    const { data, error } = await createAuthClient().auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { name: input.name, phone: input.phone } }
    });
    if (error) return sendAuthError(error, response, next, false);
    if (!data.user) return next(new Error("Supabase Auth did not return a user after registration."));

    if (!data.session) {
      return response.status(202).json({
        requiresEmailConfirmation: true,
        user: publicUser(data.user),
        message: "Check your email to confirm your account, then sign in."
      });
    }

    setSessionCookies(response, data.session);
    return response.status(201).json({ user: publicUser(data.user) });
  } catch (error) {
    return next(error);
  }
}

async function login(request, response, next) {
  const input = validateCredentials(request.body || {}, false);
  if (input.error) return response.status(400).json({ error: input.error });

  try {
    const { data, error } = await createAuthClient().auth.signInWithPassword({
      email: input.email,
      password: input.password
    });
    if (error) return sendAuthError(error, response, next, true);
    if (!data.user || !data.session) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }
    setSessionCookies(response, data.session);
    return response.json({ user: publicUser(data.user) });
  } catch (error) {
    return next(error);
  }
}

function me(request, response) {
  response.json({ user: request.user });
}

async function logout(request, response, next) {
  const accessToken = request.cookies && request.cookies.sheshield_access;
  const refreshToken = request.cookies && request.cookies.sheshield_refresh;
  clearAuthCookies(response);

  if (accessToken && refreshToken) {
    try {
      const client = createAuthClient();
      const { error: sessionError } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (!sessionError) {
        const { error } = await client.auth.signOut({ scope: "global" });
        if (error) return next(error);
      }
    } catch (error) {
      return next(error);
    }
  }
  return response.status(204).end();
}

module.exports = { login, logout, me, register };
