require("dotenv").config({ path: require("node:path").join(__dirname, ".env") });

const path = require("node:path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { checkDatabaseSchema } = require("./supabase");
const authRoutes = require("./routes/auth");
const contactsRoutes = require("./routes/contacts");
const alertsRoutes = require("./routes/alerts");
const { requireAuth } = require("./middleware/auth");

const app = express();
const port = Number(process.env.PORT) || 3000;
const webRoot = path.resolve(__dirname, "..");

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org"],
      connectSrc: ["'self'", "https://*.tile.openstreetmap.org"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "32kb", strict: true }));
app.use(cookieParser());

app.get("/api/health", async (request, response) => {
  try {
    await checkDatabaseSchema();
    response.json({ ok: true, service: "sheshield-api", database: "supabase", alertsAreSimulated: true });
  } catch (error) {
    console.error("Supabase health check failed:", error.message);
    response.status(503).json({
      ok: false,
      service: "sheshield-api",
      database: "supabase",
      error: "Supabase configuration or the required SheShield schema is not ready. Verify backend/.env and apply backend/supabase-migration.sql."
    });
  }
});
app.use("/api/auth", authRoutes);
app.use("/api/contacts", requireAuth, contactsRoutes);
app.use("/api/alerts", requireAuth, alertsRoutes);

app.use(express.static(webRoot, {
  index: "index.html",
  dotfiles: "deny",
  fallthrough: true,
  setHeaders(response, filePath) {
    if (filePath.endsWith(".html")) response.setHeader("Cache-Control", "no-store");
  }
}));

app.use("/api", (request, response) => response.status(404).json({ error: "API endpoint not found." }));
app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error.type === "entity.parse.failed") {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }
  console.error("SheShield server error:", error);
  response.status(500).json({ error: "The server could not complete this request." });
});

app.listen(port, () => {
  console.log("SheShield is ready at http://localhost:" + port);
  console.log("Supabase backend configured; SQLite files are retained as backups.");
});
