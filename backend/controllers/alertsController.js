const crypto = require("node:crypto");

const MODES = new Set(["cellular", "satellite", "offline"]);
const RETRY_MODES = new Set(["cellular", "satellite"]);
const ALERT_COLUMNS = "id,user_id,client_alert_id,alert_type,delivery_status,communication_mode,status,status_label,latitude,longitude,accuracy_m,location_source,retry_mode,created_at";

function mapAlert(row) {
  let status = row.status;
  if (!status) {
    status = row.delivery_status === "queued" ? "queued" :
      (row.delivery_status === "cancelled" ? "cancelled" : "delivered");
  }
  const statusLabel = row.status_label || (
    status === "queued" ? "Saved offline" :
      (status === "cancelled" ? "Cancelled / reset" : "Simulated delivery")
  );
  return {
    id: row.client_alert_id || String(row.id),
    mode: row.communication_mode || "unknown",
    status,
    statusLabel,
    location: row.latitude === null || row.latitude === undefined ? null : {
      lat: row.latitude,
      lng: row.longitude,
      accuracy: row.accuracy_m === undefined ? null : row.accuracy_m,
      source: row.location_source || null
    },
    retryMode: row.retry_mode || null,
    createdAt: row.created_at
  };
}

async function list(request, response, next) {
  try {
    const { data, error } = await request.supabase
      .from("alerts")
      .select(ALERT_COLUMNS)
      .eq("user_id", request.user.id)
      .order("created_at", { ascending: false });
    if (error) return next(error);
    return response.json({ alerts: data.map(mapAlert) });
  } catch (error) {
    return next(error);
  }
}

async function create(request, response, next) {
  const body = request.body || {};
  const mode = body.mode;
  if (!MODES.has(mode)) {
    return response.status(400).json({ error: "Select a supported demo communication mode." });
  }
  const retryMode = body.retryMode === undefined || body.retryMode === null ? null : body.retryMode;
  if (retryMode !== null && (mode !== "offline" || !RETRY_MODES.has(retryMode))) {
    return response.status(400).json({ error: "An offline event can only retry through cellular or satellite demo mode." });
  }
  const requestedId = body.id;
  if (requestedId !== undefined &&
      (typeof requestedId !== "string" || !/^SS-[A-Z0-9-]{8,48}$/i.test(requestedId))) {
    return response.status(400).json({ error: "Alert ID is invalid." });
  }

  let latitude = null;
  let longitude = null;
  let accuracy = null;
  let locationSource = null;
  if (body.location !== undefined && body.location !== null) {
    if (typeof body.location !== "object" || Array.isArray(body.location)) {
      return response.status(400).json({ error: "Location data is invalid." });
    }
    latitude = Number(body.location.lat);
    longitude = Number(body.location.lng);
    locationSource = body.location.source;
    accuracy = body.location.accuracy === undefined || body.location.accuracy === null
      ? null
      : Number(body.location.accuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) ||
        !["browser", "demo"].includes(locationSource)) {
      return response.status(400).json({
        error: "Location must contain valid coordinates, non-negative accuracy, and a recognised source."
      });
    }
  }

  const id = requestedId || ("SS-" + crypto.randomBytes(8).toString("hex").toUpperCase());
  try {
    const { data: existing, error: existingError } = await request.supabase
      .from("alerts")
      .select(ALERT_COLUMNS)
      .eq("user_id", request.user.id)
      .eq("client_alert_id", id)
      .maybeSingle();
    if (existingError) return next(existingError);
    if (existing) return response.json({ alert: mapAlert(existing) });

    const queued = mode === "offline" && retryMode === null;
    const { data, error } = await request.supabase
      .from("alerts")
      .insert({
        user_id: request.user.id,
        client_alert_id: id,
        alert_type: "SOS",
        communication_mode: mode,
        status: queued ? "queued" : "delivered",
        status_label: queued ? "Saved offline" : "Simulated delivery",
        latitude,
        longitude,
        accuracy_m: accuracy,
        location_source: locationSource,
        retry_mode: retryMode
      })
      .select(ALERT_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        return response.status(409).json({ error: "Alert ID is already in use." });
      }
      return next(error);
    }
    return response.status(201).json({ alert: mapAlert(data) });
  } catch (error) {
    return next(error);
  }
}

async function retryQueued(request, response, next) {
  const mode = request.body && request.body.mode;
  if (!RETRY_MODES.has(mode)) {
    return response.status(400).json({ error: "Choose cellular or satellite demo mode to retry queued events." });
  }
  try {
    const { data, error } = await request.supabase
      .from("alerts")
      .update({
        status: "delivered",
        status_label: "Simulated delivery",
        retry_mode: mode
      })
      .eq("user_id", request.user.id)
      .eq("status", "queued")
      .select("id");
    if (error) return next(error);
    return response.json({ retried: data.length, mode });
  } catch (error) {
    return next(error);
  }
}

async function cancel(request, response, next) {
  try {
    let query = request.supabase
      .from("alerts")
      .update({
        status: "cancelled",
        status_label: "Cancelled / reset"
      })
      .eq("user_id", request.user.id)
      .or("status.is.null,status.neq.cancelled");
    if (/^SS-[A-Z0-9-]+$/i.test(request.params.id)) {
      query = query.eq("client_alert_id", request.params.id);
    } else if (/^\d+$/.test(request.params.id)) {
      query = query.eq("id", Number(request.params.id));
    } else {
      return response.status(404).json({ error: "Active demo alert not found." });
    }
    const { data, error } = await query.select("id").maybeSingle();
    if (error) return next(error);
    if (!data) return response.status(404).json({ error: "Active demo alert not found." });
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
}

async function clear(request, response, next) {
  try {
    const { error } = await request.supabase
      .from("alerts")
      .delete()
      .eq("user_id", request.user.id);
    if (error) return next(error);
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
}

module.exports = { cancel, clear, create, list, mapAlert, retryQueued };
