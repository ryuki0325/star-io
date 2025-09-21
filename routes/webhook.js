const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const smm = require("../lib/smmClient");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe Webhook（raw body）
router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const sessionId = session.id;

    const db = req.app.locals.db;
    db.get("SELECT * FROM orders WHERE stripe_session_id = ?", [sessionId], async (err, row) => {
      if (err || !row) {
        console.error("Order not found for session:", sessionId, err);
        return;
      }
      try {
        // SMMFlare へ自動発注
        const resp = await smm.createOrder(row.service_id, row.link, row.quantity);
        const smmOrderId = resp.order || resp.id || "";
        db.run("UPDATE orders SET smm_order_id = ?, status = ? WHERE id = ?",
          [smmOrderId, "ordered", row.id]
        );
        console.log("✅ SMMFlare ordered:", smmOrderId);
      } catch (e) {
        console.error("SMMFlare order failed:", e.message);
        db.run("UPDATE orders SET status = ? WHERE id = ?", ["smm_error", row.id]);
      }
    });
  }

  res.json({ received: true });
});

module.exports = router;