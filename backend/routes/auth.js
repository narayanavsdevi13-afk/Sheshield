const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait and try again." }
});

router.post("/register", authLimiter, controller.register);
router.post("/login", authLimiter, controller.login);
router.get("/me", requireAuth, controller.me);
router.post("/logout", controller.logout);

module.exports = router;
