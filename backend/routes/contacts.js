const express = require("express");
const controller = require("../controllers/contactsController");

const router = express.Router();
router.get("/", controller.list);
router.post("/", controller.create);
router.delete("/:id", controller.remove);

module.exports = router;
