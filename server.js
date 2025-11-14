require("dotenv").config();
const path = require("path");
const express = require("express");
const db = require("./db");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const indexRouter = require("./routes/index");   // ユーザー用ルート
const staffRoutes = require("./routes/staff");   // スタッフ専用ルート
const affiliateRoutes = require("./routes/affiliate");

const app = express();
const PORT = process.env.PORT || 3000;

app.locals.db = db; // ✅ routes から使えるように共有

// ====== Stripe Webhook（⚠️ express.json の前に置くこと！） ======
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw body をそのまま渡す
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ 決済成功イベント
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const userId = session.metadata.userId;
    const amount = session.amount_total; // Stripe は日本円でも最小単位(円)で返す

    console.log("📦 Stripe raw amount_total:", session.amount_total);
    console.log(`💰 User ${userId} が ${amount}円 をチャージ成功`);

    try {
      await app.locals.db.query(
        "UPDATE users SET balance = balance + $1 WHERE id = $2",
        [amount, userId]
      );
      console.log(`✅ ユーザー${userId} の残高に ${amount}円 追加しました`);
    } catch (err) {
      console.error("❌ DB update error:", err);
    }
  }

  res.json({ received: true });
});

// ====== Body Parser（通常ルート用） ======
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ====== View設定 ======
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layout");

// ====== 静的ファイル ======
app.use(express.static(path.join(__dirname, "public")));

// ====== セッション ======
app.use(
  session({
    secret: process.env.SESSION_SECRET || "smmflare-secret",
    resave: false,
    saveUninitialized: false,
  })
);

(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reset_token TEXT,
      reset_expires TIMESTAMP
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      service_id TEXT,
      service_name TEXT,
      link TEXT,
      quantity INTEGER,
      price_jpy INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE,
      discount_value INTEGER,
      description TEXT,
      valid_until DATE,
      max_uses INTEGER DEFAULT 1,
      used_count INTEGER DEFAULT 0
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS coupon_redemptions (
      id SERIAL PRIMARY KEY,
      coupon_id INTEGER,
      user_id INTEGER,
      redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (coupon_id) REFERENCES coupons(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    console.log("✅ Database tables are ready");
  } catch (err) {
    console.error("❌ DB setup error:", err);
  }
})();

// ====== 料金倍率をアプリ全体に共有 ======
app.locals.PRICE_MULTIPLIER = parseFloat(process.env.PRICE_MULTIPLIER || "1");

// ====== 全ページでユーザーとスタッフ情報を共有 ======
app.use(async (req, res, next) => {
  if (req.session.userId) {
    try {
      const result = await db.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
      const user = result.rows[0];

      if (user) {
        req.session.user = user;   // セッションに保存
        res.locals.user = user;    // EJSで使えるようにする
      } else {
        res.locals.user = null;
      }
    } catch (err) {
      console.error("❌ DB error in middleware:", err);
      res.locals.user = null;
    }
    res.locals.isStaff = !!req.session.isStaff;
    next();
  } else {
    res.locals.user = null;
    res.locals.isStaff = !!req.session.isStaff;
    next();
  }
});

// ====== ルーティング ======
app.use("/", indexRouter);
app.use("/staff", staffRoutes);
app.use("/", affiliateRoutes);

// ====== 起動 ======
app.listen(PORT, () => {
  console.log(`✅ Running: http://localhost:${PORT}`);
});
