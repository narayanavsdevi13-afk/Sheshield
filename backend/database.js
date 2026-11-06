const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const databasePath = process.env.SHESHIELD_DB_PATH
  ? path.resolve(process.env.SHESHIELD_DB_PATH)
  : path.join(__dirname, "data", "sheshield.sqlite");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS contacts_user_id_idx ON contacts(user_id);

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('cellular', 'satellite', 'offline')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'cancelled')),
    status_label TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    location_source TEXT CHECK (location_source IS NULL OR location_source IN ('browser', 'demo')),
    retry_mode TEXT CHECK (retry_mode IS NULL OR retry_mode IN ('cellular', 'satellite')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS alerts_user_created_idx ON alerts(user_id, created_at DESC);
`);

const alertColumns = db.pragma("table_info(alerts)");
if (!alertColumns.some((column) => column.name === "accuracy_m")) {
  db.exec("ALTER TABLE alerts ADD COLUMN accuracy_m REAL");
}

module.exports = db;
