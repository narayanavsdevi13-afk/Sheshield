function mapContact(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    createdAt: row.created_at
  };
}

async function list(request, response, next) {
  try {
    const { data, error } = await request.supabase
      .from("contacts")
      .select("id,user_id,name,phone,created_at")
      .eq("user_id", request.user.id)
      .order("created_at", { ascending: false });
    if (error) return next(error);
    return response.json({ contacts: data.map(mapContact) });
  } catch (error) {
    return next(error);
  }
}

async function create(request, response, next) {
  const body = request.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const digits = phone.replace(/\D/g, "").length;
  if (name.length < 2 || name.length > 70) {
    return response.status(400).json({ error: "Name must be between 2 and 70 characters." });
  }
  if (phone.length > 20 || digits < 7 || digits > 15) {
    return response.status(400).json({ error: "Enter a valid phone number with 7–15 digits." });
  }

  try {
    const { data: existing, error: existingError } = await request.supabase
      .from("contacts")
      .select("id,phone")
      .eq("user_id", request.user.id);
    if (existingError) return next(existingError);
    if (existing.some((contact) => contact.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""))) {
      return response.status(409).json({ error: "That phone number is already in your trusted contacts." });
    }
    if (existing.length >= 10) {
      return response.status(400).json({ error: "You can add up to 10 trusted contacts." });
    }

    const { data, error } = await request.supabase
      .from("contacts")
      .insert({ user_id: request.user.id, name, phone })
      .select("id,user_id,name,phone,created_at")
      .single();
    if (error) {
      if (error.code === "23505") {
        return response.status(409).json({ error: "That phone number is already in your trusted contacts." });
      }
      return next(error);
    }
    return response.status(201).json({ contact: mapContact(data) });
  } catch (error) {
    return next(error);
  }
}

async function remove(request, response, next) {
  try {
    const { data, error } = await request.supabase
      .from("contacts")
      .delete()
      .eq("id", request.params.id)
      .eq("user_id", request.user.id)
      .select("id")
      .maybeSingle();
    if (error) return next(error);
    if (!data) return response.status(404).json({ error: "Trusted contact not found." });
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, remove };
