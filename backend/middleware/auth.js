const { createAuthClient, createUserClient } = require("../supabase");

const ACCESS_COOKIE = "sheshield_access";
const REFRESH_COOKIE = "sheshield_refresh";
const REFRESH_COOKIE_DAYS = 30;

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || process.env.SESSION_COOKIE_SECURE === "true",
    path: "/",
    maxAge
  };
}

function setSessionCookies(response, session) {
  const accessMaxAge = Math.max(1, Number(session.expires_in) || 3600) * 1000;
  response.cookie(ACCESS_COOKIE, session.access_token, cookieOptions(accessMaxAge));
  response.cookie(
    REFRESH_COOKIE,
    session.refresh_token,
    cookieOptions(REFRESH_COOKIE_DAYS * 24 * 60 * 60 * 1000)
  );
}

function clearAuthCookies(response) {
  response.clearCookie(ACCESS_COOKIE, cookieOptions());
  response.clearCookie(REFRESH_COOKIE, cookieOptions());
}

function toPublicUser(user) {
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    name: typeof metadata.name === "string" ? metadata.name : "",
    email: user.email,
    phone: typeof metadata.phone === "string" ? metadata.phone : ""
  };
}

function isAuthServiceUnavailable(error) {
  return Boolean(error && (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    /fetch failed|network error|timeout/i.test(error.message || "")
  ));
}

async function requireAuth(request, response, next) {
  const accessToken = request.cookies && request.cookies[ACCESS_COOKIE];
  const refreshToken = request.cookies && request.cookies[REFRESH_COOKIE];

  try {
    let activeAccessToken = accessToken;
    let user = null;
    let verificationError = null;

    if (activeAccessToken) {
      const { data, error } = await createAuthClient().auth.getUser(activeAccessToken);
      if (!error) user = data.user;
      else verificationError = error;
    }

    if (!user && refreshToken) {
      const { data, error } = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken });
      if (!error && data.session && data.user) {
        activeAccessToken = data.session.access_token;
        user = data.user;
        setSessionCookies(response, data.session);
      } else if (isAuthServiceUnavailable(error)) {
        return response.status(503).json({ error: "Unable to verify your session right now. Please try again." });
      }
    }

    if (!user && isAuthServiceUnavailable(verificationError)) {
      return response.status(503).json({ error: "Unable to verify your session right now. Please try again." });
    }
    if (!user || !activeAccessToken) {
      clearAuthCookies(response);
      return response.status(401).json({ error: "Your session expired. Please sign in again." });
    }

    request.user = toPublicUser(user);
    request.supabase = createUserClient(activeAccessToken);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  requireAuth,
  setSessionCookies,
  toPublicUser
};
