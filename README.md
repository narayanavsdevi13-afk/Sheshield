# SheShield

**One Ring. One Touch. A Stronger Shield.**

SheShield is a responsive prototype for a future safety-ring product. Its website can store accounts through Supabase Auth and save trusted contacts and demo alert history in Supabase. It does **not** connect to a physical ring, emergency service, cellular network, satellite service, or real notification provider. Delivery states are simulations only.

## Run the application

Use the Express server so the site and API share one origin:

1. Install Node.js 20 or newer.
2. Configure `backend/.env` with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Use a publishable/anon key only; never use a service-role key.
3. Apply the reviewed SQL in [`backend/supabase-migration.sql`](./backend/supabase-migration.sql) to the configured Supabase project. Before applying it, inspect existing policies; the script adds owner-scoped policies but does not remove any existing policy.
4. From a VS Code terminal, run:

   ```powershell
   cd backend
   npm install
   npm start
   ```

5. Open **http://localhost:3000**. `GET /api/health` must return `{"ok":true,"database":"supabase",...}` before the frontend marks the backend connected.

If Supabase is unavailable or the required schema is incomplete, the API reports an unhealthy status and the frontend labels its local-browser fallback **LOCAL DEMO**. It does not report the backend as connected.

## Supabase schema and security

The configured project currently has `contacts` columns `id`, `user_id`, `name`, `phone`, and `created_at`. Its existing `alerts` table has integer `id`, `user_id`, `alert_type`, `latitude`, `longitude`, `delivery_status`, and `created_at`; the SheShield-specific communication mode, alert status, browser accuracy, and idempotency fields are not present in that existing schema. The existing integer primary keys are also required on insert and have no generated defaults.

The migration script adds the missing alert columns and generated integer ID sequences without dropping or rewriting existing records, creates a per-user unique index for client alert IDs, and adds `authenticated`-only operation policies plus restrictive owner guards for both tables. The restrictive guards narrow any pre-existing permissive policies rather than removing them. Review all policies returned by the final `pg_policies` query before relying on RLS and do not remove or weaken policies without first reviewing the project’s security requirements.

The Express API proxies sign-up and sign-in through Supabase Auth. Access and refresh tokens are held in HttpOnly, SameSite cookies; protected database requests use the signed-in user’s access token and additionally filter by that user ID. RLS remains the database-side authorization boundary. The publishable key stays in `backend/.env` and is not included in frontend code. Email confirmation may be required by the Supabase Auth project settings; when it is, the app asks the user to confirm before signing in.

Existing SQLite code and files in `backend/data/` are retained as backups and are no longer used by the active API. SQLite users/contacts/alerts are not automatically imported into Supabase. The migration SQL is a prerequisite and must be applied in the Supabase SQL Editor; this project does not execute remote schema changes automatically.

## API routes

- `GET /api/health`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET|POST /api/contacts`, `DELETE /api/contacts/:id`
- `GET|POST|DELETE /api/alerts`, `POST /api/alerts/retry`, `PATCH /api/alerts/:id/cancel`

All contact and alert routes require a valid Supabase Auth session. Browser-originated API calls remain same-origin; no CORS exception is required.

## What is and is not real

- Supabase Auth manages accounts and Supabase stores contacts and demo alert records after the schema migration is applied.
- In **LOCAL DEMO** mode, prototype information is stored in that browser's local storage. Do not enter sensitive personal information.
- Cellular and satellite modes only mark an event as simulated delivery. They never transmit.
- Offline mode queues a demo event in browser storage. Selecting a cellular/satellite demo mode synchronizes it to the API and marks it as simulated; it does not transmit or notify anyone.
- Location requires an explicit browser permission request. If location isn't available, the alert can still be created without coordinates; demo map coordinates are labelled as simulated.
- Trusted contacts are stored as records only. No messages or calls are sent to them.

## Safety and production limitations

SheShield is not an emergency service and is not a replacement for emergency services. The website cannot dispatch assistance, send calls or messages, or guarantee an alert is received. In immediate danger, contact your local emergency number directly.

This is a local hackathon backend, not a production deployment. Before handling real users or emergencies, add a reviewed deployment and threat model, HTTPS and secure cookies, account recovery and verification, database backup/retention controls, monitoring, abuse protection, and tested incident response. Real hardware operation would also require validated firmware, secure device identity and transport, compatible cellular connectivity or an authorised satellite service, and device-level offline/reconnection safety testing.
