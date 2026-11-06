const express = require("express");
const controller = require("../controllers/alertsController");

const router = express.Router();
router.get("/", controller.list);
router.post("/", controller.create);
router.post("/retry", controller.retryQueued);
router.delete("/", controller.clear);
router.patch("/:id/cancel", controller.cancel);

module.exports = router;
