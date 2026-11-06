require("dotenv").config({ path: require("node:path").join(__dirname, ".env") });

const { createClient } = require("@supabase/supabase-js");

const authOptions = {
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false
};

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured in backend/.env.");
  }
  return { url, publishableKey };
}

function createAuthClient() {
  const config = getConfig();
  return createClient(config.url, config.publishableKey, { auth: authOptions });
}

function createUserClient(accessToken) {
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("A Supabase access token is required for user-scoped database access.");
  }
  const config = getConfig();
  return createClient(config.url, config.publishableKey, {
    auth: authOptions,
    global: { headers: { Authorization: "Bearer " + accessToken } }
  });
}

async function checkDatabaseSchema() {
  const client = createAuthClient();
  const config = getConfig();
  const checks = [
    ["contacts", "id,user_id,name,phone,created_at"],
    ["alerts", "id,user_id,client_alert_id,alert_type,delivery_status,communication_mode,status,status_label,latitude,longitude,accuracy_m,location_source,retry_mode,created_at"]
  ];

  for (const [table, columns] of checks) {
    const { error } = await client.from(table).select(columns).limit(0);
    if (error) {
      throw new Error("Supabase schema check failed for " + table + ": " + error.message);
    }
  }

  const response = await fetch(config.url.replace(/\/$/, "") + "/rest/v1/", {
    headers: {
      apikey: config.publishableKey,
      Accept: "application/openapi+json"
    }
  });
  if (!response.ok) throw new Error("Supabase REST schema metadata is unavailable.");
  const schema = await response.json();
  for (const table of ["contacts", "alerts"]) {
    if (!schema.definitions || !schema.definitions[table]) {
      throw new Error("Supabase REST schema metadata is missing the " + table + " table.");
    }
  }
}

module.exports = { createAuthClient, createUserClient, checkDatabaseSchema };
