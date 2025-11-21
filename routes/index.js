require("dotenv").config();
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const smm = require("../lib/smmClient");
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const Announcement = require("../models/announcementModel");


// 優先アプリ
const priorityApps = ["TikTok", "Instagram", "YouTube", "Twitter", "Spotify", "Telegram", "Twitch", "Facebook"];

// 除外アプリ
const excludedApps = [
];

// 絵文字マップ
const emojiMap = {
  TikTok: "🎵",
  Instagram: "📸",
  YouTube: "▶️",
  Twitter: "🐦",
  Spotify: "🎧",
  Telegram: "✉️",
  Twitch: "🎮",
  Facebook: "📘",
  Reddit: "👽"
};

// ================== ホーム ==================
router.get("/", async (req, res) => {
  const apps = ["TikTok","Instagram","YouTube","Twitter","Spotify","Telegram","Twitch","Facebook","Reddit"];
  const db = req.app.locals.db;

  // アイコンマップ
  const emojiMap = {
    TikTok: "🎵",
    Instagram: "📸",
    YouTube: "▶️",
    Twitter: "🐦",
    Spotify: "🎧",
    Telegram: "✈️",
    Twitch: "🎮",
    Facebook: "👥",
    Reddit: "👽"
  };

  try {
    // ⭐ お知らせを全部取得（新しい順）
    const announcements = await Announcement.getAll();

    // --- 未ログイン時 ---
    if (!req.session.userId) {
      return res.render("dashboard", {
        title: "ホーム",
        apps,
        user: null,
        orders: [],
        emojiMap,
        announcements   // ← 追加
      });
    }

    // --- ログイン時: 注文取得 ---
    const result = await db.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC",
      [req.session.userId]
    );
    const orders = result.rows;

    res.render("dashboard", {
      title: "ホーム",
      apps,
      user: req.session.user,
      orders,
      emojiMap,
      announcements     // ← 追加
    });
  } catch (err) {
    console.error("❌ ダッシュボードエラー:", err);
    // 失敗したらお知らせは空配列で表示
    res.render("dashboard", {
      title: "ホーム",
      apps,
      user: req.session.user || null,
      orders: [],
      emojiMap,
      announcements: []
    });
  }
});

// ================== サインアップ ==================
router.get("/signup", (req, res) => {
  const { ref } = req.query;   // ← ref追加版！
  res.render("signup", { title: "新規登録", error: null, ref });
});

// ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓
// ここが書き換え後のアフィリエイト対応版
router.post("/signup", async (req, res) => {
  const { email, password, ref } = req.body;
  const db = req.app.locals.db;

  try {
    const hash = await bcrypt.hash(password, 10);

    const existing = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.render("signup", { 
        title: "新規登録", 
        error: "このメールアドレスは既に登録されています。",
        ref
      });
    }

    let referredBy = null;
    if (ref) {
      const refUser = await db.query(
        "SELECT id FROM users WHERE referral_code = $1",
        [ref]
      );
      if (refUser.rows.length > 0) {
        referredBy = refUser.rows[0].id;
      }
    }

    const crypto = require("crypto");
    const myRefCode = crypto.randomBytes(4).toString("hex");

    await db.query(
      `INSERT INTO users (email, password_hash, balance, referral_code, referred_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [email, hash, 0, myRefCode, referredBy]
    );

    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];

    req.session.userId = user.id;
    req.session.user = { id: user.id, email: user.email, balance: user.balance || 0 };

    res.redirect("/mypage");

  } catch (err) {
    return res.render("signup", { 
      title: "新規登録", 
      error: "登録に失敗しました: " + err.message,
      ref
    });
  }
});

// ================== ログイン / ログアウト =================
// ================== ログインページ ==================
router.get("/login", (req, res) => {
  res.render("login", { title: "ログイン", error: null });
});

// ================== ログイン処理 ==================
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const db = req.app.locals.db;

  try {
    // --- ユーザーを検索 ---
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];

    // --- 存在チェック ---
    if (!user) {
      return res.render("login", {
        title: "ログイン",
        error: "ユーザーが存在しません。"
      });
    }

    // --- パスワード確認 ---
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render("login", {
        title: "ログイン",
        error: "メールアドレスまたはパスワードが間違っています。"
      });
    }

    // --- セッション保存 ---
    req.session.userId = user.id;
    req.session.user = user;

    // --- 管理者チェック ---
const adminEmail = process.env.ADMIN_LOGIN_EMAIL?.trim() || null;

if (adminEmail && user.email === adminEmail) {
  req.session.isStaff = true;
  console.log("✅ 管理者ログイン:", user.email);
  res.redirect("/staff/dashboard");
} else {
  // ✅ それ以外は全員マイページへ
  req.session.isStaff = false;
  console.log("✅ 一般ユーザーログイン:", user.email);
  res.redirect("/mypage");
}

  } catch (err) {
    console.error("ログイン中にエラー:", err);
    return res.render("login", {
      title: "ログイン",
      error: "サーバーエラーが発生しました。"
    });
  }
});

// ================== ログアウト処理 ==================
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

module.exports = router;

// ====== チャージページ（GET /funds） ======
router.get("/funds", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const db = req.app.locals.db;

  try {
    // ✅ 現在の残高を取得
    const result = await db.query("SELECT balance FROM users WHERE id = $1", [req.session.userId]);
    const balance = result.rows[0] ? Number(result.rows[0].balance) : 0;

    // ✅ 表示
    res.render("funds", {
      title: "残高チャージ",
      user: req.session.user,
      balance,
      error: null
    });
  } catch (err) {
    console.error("❌ チャージページエラー:", err);
    res.render("funds", {
      title: "残高チャージ",
      user: req.session.user,
      balance: 0,
      error: "残高の取得に失敗しました。"
    });
  }
});

// ================== 通常の（ダミー）チャージ処理 ==================
router.post("/funds", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const db = req.app.locals.db;
  const { amount } = req.body;
  const addAmount = parseInt(amount, 10);

  if (isNaN(addAmount) || addAmount <= 0) {
    return res.render("funds", {
      title: "残高チャージ",
      user: req.session.user,
      balance: req.session.user?.balance || 0,
      error: "正しい金額を入力してください。"
    });
  }

  try {
    // 残高を加算
    await db.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [
      addAmount,
      req.session.userId
    ]);

    // 最新のユーザー情報を取得してセッションを更新
    const result = await db.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const user = result.rows[0];
    if (user) req.session.user = user;

    res.redirect("/mypage");
  } catch (err) {
    console.error("残高更新エラー:", err);
    res.render("funds", {
      title: "残高チャージ",
      user: req.session.user,
      balance: req.session.user?.balance || 0,
      error: "残高更新に失敗しました。"
    });
  }
});

// ================== Stripe決済 ==================
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// チェックアウトセッション作成
router.post("/create-checkout-session", async (req, res) => {
  if (!req.session.userId) return res.status(403).send("ログインしてください");

  const { amount } = req.body;
  if (!amount || amount < 1000) {
    return res.status(400).send("1000円以上からチャージ可能です");
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "jpy",
            product_data: { name: "残高チャージ" },
            unit_amount: amount,  // ✅ ここを修正！そのまま「円単位」で渡す
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `http://localhost:3000/funds/success?amount=${amount}`,
      cancel_url: `http://localhost:3000/funds/cancel`,
      metadata: {
        userId: req.session.userId.toString(),
        amount: amount.toString()
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripeセッション作成エラー:", err);
    res.status(500).send("決済セッション作成に失敗しました");
  }
});

// ====== チャージ成功ページ（PostgreSQL対応版） ======
router.get("/funds/success", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const db = req.app.locals.db;
  const chargeAmount = req.query.amount ? parseInt(req.query.amount, 10) : null;

  try {
    // ✅ 最新の残高を取得
    const result = await db.query("SELECT balance FROM users WHERE id = $1", [req.session.userId]);
    const balance = result.rows[0] ? Number(result.rows[0].balance) : 0;

    // ✅ セッションを最新化（オプション）
    req.session.user.balance = balance;

    // ✅ チャージ成功ページを表示
    res.render("funds-success", {
      title: "チャージ成功",
      user: req.session.user,
      chargeAmount: chargeAmount || 0,
      balance
    });
  } catch (err) {
    console.error("❌ チャージ成功ページエラー:", err);
    res.render("funds-success", {
      title: "チャージ成功",
      user: req.session.user,
      chargeAmount: chargeAmount || 0,
      balance: 0,
      error: "残高の取得に失敗しました。"
    });
  }
});

// ====== Stripe チャージのキャンセルページ ======
router.get("/funds/cancel", (req, res) => {
  res.render("funds-cancel", {
    title: "チャージキャンセル",
    user: req.session.user,
  });
});

// ================== 注文ページ ==================
router.get("/order", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const raw = await smm.getServices();

  // --- 👑おすすめサービスを.envから取得 ---
const recommended = process.env.RECOMMENDED_SERVICES
  ? process.env.RECOMMENDED_SERVICES.split(",").map(id => id.trim())
  : [];

  // --- アプリ名を正規化する関数 ---
  function normalizeAppName(name) {
    const app = (name.split(" ")[0] || "その他").trim().toLowerCase();
    if (["tiktok","tik tok"].includes(app)) return "TikTok";
    if (["instagram","insta"].includes(app)) return "Instagram";
    if (["twitter","x"].includes(app)) return "Twitter";
    if (["youtube","yt"].includes(app)) return "YouTube";
    if (["spotify"].includes(app)) return "Spotify";
    if (["telegram"].includes(app)) return "Telegram";
    if (["twitch"].includes(app)) return "Twitch";
    if (["facebook","fb"].includes(app)) return "Facebook";
    if (["reddit"].includes(app)) return "Reddit";
    return app.charAt(0).toUpperCase() + app.slice(1);
  }

  // --- サービス種別を判定する関数 ---
  function detectType(name) {
    const lower = name.toLowerCase();
    if (lower.includes("follower")) return "フォロワー";
    if (lower.includes("like")) return "いいね";
    if (lower.includes("view")) return "再生数";
    if (lower.includes("comment")) return "コメント";
    if (lower.includes("share")) return "シェア";
    return "その他";
  }

  // --- 環境変数ベースの倍率ロジック ---
  function applyPriceMultiplier(price) {
    if (price <= 100) {
      return price * parseFloat(process.env.MULTIPLIER_LOW || 2.0);
    } else if (price <= 1000) {
      return price * parseFloat(process.env.MULTIPLIER_MID || 1.5);
    } else if (price <= 1600) {
      return price * parseFloat(process.env.MULTIPLIER_HIGH || 1.3);
    } else {
      return price * parseFloat(process.env.MULTIPLIER_TOP || 1.1);
    }
  }

  // --- サービスをグループ化 ---
const grouped = {};
(raw || []).forEach(s => {
  let app = normalizeAppName(s.name);
  const type = detectType(s.name);

  if (!grouped[app]) grouped[app] = {};
  if (!grouped[app][type]) grouped[app][type] = [];

  // ✅ 基本レートを保持 & 倍率を適用
  const JPY_RATE = parseFloat(process.env.JPY_RATE || "150");

  // APIのレート（ドル建て）をまず円換算
  const baseRate = parseFloat(s.rate) * JPY_RATE;

  // 段階的な倍率を適用
  const finalRate = applyPriceMultiplier(baseRate);

  grouped[app][type].push({
    service: s.service,
    name: s.name,
    baseRate,
    finalRate  // ✅ ここで渡す
  });
});

  // --- アプリ順序を決定 ---
  const appOrder = Object.keys(grouped).sort((a, b) => {
    const aP = priorityApps.includes(a) ? priorityApps.indexOf(a) : Infinity;
    const bP = priorityApps.includes(b) ? priorityApps.indexOf(b) : Infinity;
    if (aP !== bP) return aP - bP;
    return a.localeCompare(b);
  });

  // --- レンダリング ---
  res.render("order", {
    title: "新規注文",
    grouped,
    appOrder,
    recommended, // 👑 ← ★これを追加！
    selectedApp: req.query.app || "",
    selectedType: req.query.type || "",
    balance: Number(req.session.user?.balance || 0) // 数値で渡す
  });
})

// ================== ギフトコード (ページ) ==================
router.get("/coupon", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  res.render("coupon", {
    title: "ギフトコード",
    user: req.session.user,
    success: null,
    error: null
  });
});

// ================== ギフトコード (ページ) ==================
router.get("/coupon", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  res.render("coupon", {
    title: "ギフトコード",
    user: req.session.user,
    success: null,
    error: null
  });
});

// ================== ギフトコード適用 (POST /redeem) ==================

router.post("/redeem", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const db = req.app.locals.db;
  const code = (req.body.code || "").trim();


  if (!code) {
    return res.render("coupon", {
      title: "ギフトコード",
      user: req.session.user,
      success: null,
      error: "コードを入力してください。"
    });
  }

  try {
    // ✅ クーポン検索
    const couponResult = await db.query("SELECT * FROM coupons WHERE code = $1", [code]);
    const coupon = couponResult.rows[0];

    if (!coupon) {
      return res.render("coupon", {
        title: "ギフトコード",
        user: req.session.user,
        success: null,
        error: "無効なコードです。"
      });
    }

    // ✅ 有効期限チェック
    if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) {
      return res.render("coupon", {
        title: "ギフトコード",
        user: req.session.user,
        success: null,
        error: "このコードは期限切れです。"
      });
    }

    // ✅ 使用回数上限チェック
    if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
      return res.render("coupon", {
        title: "ギフトコード",
        user: req.session.user,
        success: null,
        error: "このコードは使用上限に達しています。"
      });
    }

    // ✅ 重複使用チェック
    const redemptionCheck = await db.query(
      "SELECT id FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2",
      [coupon.id, req.session.userId]
    );
    if (redemptionCheck.rows.length > 0) {
      return res.render("coupon", {
        title: "ギフトコード",
        user: req.session.user,
        success: null,
        error: "このコードは既に使用済みです。"
      });
    }

    // ✅ 使用回数更新
    await db.query("UPDATE coupons SET used_count = used_count + 1 WHERE id = $1", [coupon.id]);

    // ✅ 使用履歴登録
    await db.query("INSERT INTO coupon_redemptions (coupon_id, user_id) VALUES ($1, $2)", [
      coupon.id,
      req.session.userId
    ]);

    // ✅ 最新ユーザー情報を再取得してセッション更新
    const userResult = await db.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    if (userResult.rows[0]) req.session.user = userResult.rows[0];

    // ✅ 成功メッセージ表示
    res.render("coupon", {
      title: "ギフトコード",
      user: req.session.user,
      success: `🎁 コード「${code}」を適用しました！ ${coupon.discount_value} 円が残高に追加されました。`,
      error: null
    });

  } catch (err) {
    console.error("❌ ギフトコード処理エラー:", err);
    res.render("coupon", {
      title: "ギフトコード",
      user: req.session.user,
      success: null,
      error: "サーバーエラーが発生しました。"
    });
  }
});


// ================== 注文処理 ==================
router.post("/order", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const { serviceId, link, quantity } = req.body;
  const db = req.app.locals.db;

  // ✅ 利益倍率ロジック
  function applyPriceMultiplier(price) {
    const low  = parseFloat(process.env.MULTIPLIER_LOW  || "2.0");
    const mid  = parseFloat(process.env.MULTIPLIER_MID  || "1.5");
    const high = parseFloat(process.env.MULTIPLIER_HIGH || "1.3");
    const top  = parseFloat(process.env.MULTIPLIER_TOP  || "1.1");

    if (price <= 100) return price * low;
    else if (price <= 1000) return price * mid;
    else if (price <= 1600) return price * high;
    else return price * top;
  }

  try {
    // ✅ SMMFlareサービスリストを取得
    const services = await smm.getServices();
    const svc = services.find(s => String(s.service) === String(serviceId));
    console.log("🟩 該当サービスID:", serviceId);
    console.log("🟩 該当サービス:", services.find(s => String(s.service) === String(serviceId)));
    if (!svc) return res.send("サービスが見つかりません");

    // ✅ 為替レート（例: 1ドル=150円）
    const JPY_RATE = parseFloat(process.env.JPY_RATE || "150");

    // ✅ 仕入れ価格（ドル & 円）
    const smm_cost_usd = (parseFloat(svc.rate) / 1000) * Number(quantity);
    const smm_cost_jpy = smm_cost_usd * JPY_RATE;

    // ✅ 販売価格（倍率をかけた価格）
    const unitRate = applyPriceMultiplier(parseFloat(svc.rate) * JPY_RATE);
    const amount = (unitRate / 1000) * Number(quantity);

    // ✅ 残高チェック
    const { rows } = await db.query(
  "SELECT balance FROM users WHERE id = $1",
  [req.session.userId]
);
const balance = parseFloat(rows[0]?.balance || 0);
    if (balance < amount) {
  // 👑 おすすめID（.envで RECOMMENDED_SERVICES=123,456 など）
  const recommended = process.env.RECOMMENDED_SERVICES
    ? process.env.RECOMMENDED_SERVICES.split(",").map(id => id.trim())
    : [];

  // --- GET /order と同じロジックで grouped を作成 ---
  const normalizeAppName = (name) => {
    const app = (name.split(" ")[0] || "その他").trim().toLowerCase();
    if (["tiktok","tik tok"].includes(app)) return "TikTok";
    if (["instagram","insta"].includes(app)) return "Instagram";
    if (["twitter","x"].includes(app)) return "Twitter";
    if (["youtube","yt"].includes(app)) return "YouTube";
    if (["spotify"].includes(app)) return "Spotify";
    if (["telegram"].includes(app)) return "Telegram";
    if (["twitch"].includes(app)) return "Twitch";
    if (["facebook","fb"].includes(app)) return "Facebook";
    if (["reddit"].includes(app)) return "Reddit";
    return app.charAt(0).toUpperCase() + app.slice(1);
  };
  const detectType = (name) => {
    const lower = name.toLowerCase();
    if (lower.includes("follower")) return "フォロワー";
    if (lower.includes("like"))     return "いいね";
    if (lower.includes("view"))     return "再生数";
    if (lower.includes("comment"))  return "コメント";
    if (lower.includes("share"))    return "シェア";
    return "その他";
  };
  const applyPriceMultiplier = (price) => {
    const low  = parseFloat(process.env.MULTIPLIER_LOW  || "2.0");
    const mid  = parseFloat(process.env.MULTIPLIER_MID  || "1.5");
    const high = parseFloat(process.env.MULTIPLIER_HIGH || "1.3");
    const top  = parseFloat(process.env.MULTIPLIER_TOP  || "1.1");
    if (price <= 100)  return price * low;
    if (price <= 1000) return price * mid;
    if (price <= 1600) return price * high;
    return price * top;
  };

  // services はこの直前で取得済み（const services = await smm.getServices();）
  const grouped = {};
  const JPY_RATE = parseFloat(process.env.JPY_RATE || "150");
  (services || []).forEach(s => {
    const app  = normalizeAppName(s.name);
    const type = detectType(s.name);
    if (!grouped[app]) grouped[app] = {};
    if (!grouped[app][type]) grouped[app][type] = [];
    const baseRate  = parseFloat(s.rate) * JPY_RATE;
    const finalRate = applyPriceMultiplier(baseRate);
    grouped[app][type].push({ service: s.service, name: s.name, baseRate, finalRate });
  });

  const priority = ["TikTok","Instagram","YouTube","Twitter","Spotify","Telegram","Twitch","Facebook"];
  const appOrder = Object.keys(grouped).sort((a, b) => {
    const ap = priority.indexOf(a), bp = priority.indexOf(b);
    if (ap === -1 && bp === -1) return a.localeCompare(b);
    if (ap === -1) return 1;
    if (bp === -1) return -1;
    return ap - bp;
  });

  const selectedApp  = normalizeAppName(svc.name);
  const selectedType = detectType(svc.name);

  // ✅ 別ページに飛ばさず、views/order.ejs を再描画
  return res.render("order", {
    title: "新規注文",
    grouped,
    appOrder,
    recommended,
    balance,                                 // 現在残高
    error: "残高不足です。",                 // 🔴 ここが order.ejs に表示される
    totalPrice: Math.round(amount * 100) / 100,
    link,
    quantity,
    selectedApp,
    selectedType,
    selectedServiceId: String(serviceId)
  });
}
    // ✅ 残高を減算
    await db.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [amount, req.session.userId]);

    // ✅ SMMFlare APIに注文送信
    const orderRes = await smm.createOrder(serviceId, link, quantity);

    // ✅ 注文データ保存
    await db.query(
      `INSERT INTO orders 
       (user_id, service_id, service_name, link, quantity, price_jpy, smm_order_id, smm_cost_jpy, created_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'pending')`,
      [
        req.session.userId,
        serviceId,
        svc.name,
        link,
        quantity,
        amount,
        orderRes.order,
        smm_cost_jpy
      ]
    );

    // ✅ 表示
    res.render("order_success", {
      title: "注文完了",
      orderId: orderRes.order,
      serviceName: svc.name,
      quantity,
      amount: amount.toFixed(2),
      smm_cost_usd: smm_cost_usd.toFixed(2),
      smm_cost_jpy: smm_cost_jpy.toFixed(2),
      balance: (balance - amount).toFixed(2)
    });

  } catch (err) {
    console.error("❌ 注文処理エラー:", err.message || err);
    res.status(500).send("サーバーエラーが発生しました。");
  }
});

// ================== 注文履歴 ==================
router.get("/orders", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const db = req.app.locals.db;

  try {
    const result = await db.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC",
      [req.session.userId]
    );
    const orders = result.rows.map(order => {
      if (order.created_at) {
        const date = new Date(order.created_at);
        order.created_at_local = date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      } else {
        order.created_at_local = "不明";
      }
      return order;
    });

    res.render("orders", { title: "注文履歴", orders });
  } catch (err) {
    console.error("注文履歴エラー:", err);
    res.render("orders", { title: "注文履歴", orders: [] });
  }
});

// ================== お問い合わせページ ==================
router.get("/contact", (req, res) => {
  res.render("contact", {
    title: "お問い合わせ",
    success: null,
    error: null
  });
});

// ================== お問い合わせ送信 ==================
router.post("/contact", async (req, res) => {
  const { category, subcategory, orderId, email, message } = req.body;

  // ====== 入力チェック ======
  if (!email || !message) {
    return res.render("contact", {
      title: "お問い合わせ",
      success: null,
      error: "メールアドレスと内容は必須です。"
    });
  }

  try {
    // ====== Nodemailer設定（Gmail推奨） ======
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // SSLを使用
      auth: {
        user: process.env.CONTACT_EMAIL,
        pass: process.env.CONTACT_EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false // ✅ RenderなどでSSL検証を緩める（安全）
      }
    });

    // ====== メール内容 ======
    const mailOptions = {
      from: `"$tart.io サポート" <${process.env.CONTACT_EMAIL}>`,
      to: process.env.CONTACT_EMAIL, // 管理者（自分）宛
      replyTo: email, // 返信先をユーザーのメールに
      subject: `【お問い合わせ】${category || "未選択"} - ${subcategory || "未選択"}`,
      text: `
━━━━━━━━━━━━━━━━━━━
📩 お問い合わせが届きました
━━━━━━━━━━━━━━━━━━━

カテゴリ: ${category || "未選択"}
サブカテゴリ: ${subcategory || "未選択"}
注文ID: ${orderId || "なし"}
送信者メール: ${email}

内容:
${message}

━━━━━━━━━━━━━━━━━━━
送信日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
━━━━━━━━━━━━━━━━━━━
`
    };

    // ====== メール送信 ======
    await transporter.sendMail(mailOptions);
    console.log(`✅ お問い合わせメール送信成功: ${email}`);

    // ====== 成功時の再表示 ======
    res.render("contact", {
      title: "お問い合わせ",
      success: "送信が完了しました！内容を確認し、順次ご対応いたします。",
      error: null
    });

  } catch (err) {
    console.error("❌ お問い合わせ送信エラー:", err);

    // Gmailなどでタイムアウト・認証失敗の可能性に対応
    const msg =
      err.code === "ETIMEDOUT"
        ? "サーバーへの接続がタイムアウトしました。時間をおいて再度お試しください。"
        : "メール送信に失敗しました。時間をおいて再度お試しください。";

    res.render("contact", {
      title: "お問い合わせ",
      success: null,
      error: msg
    });
  }
});

// ================== マイページ ==================
router.get("/mypage", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const db = req.app.locals.db;

  try {
    // ✅ 注文履歴（最新10件）を取得
    const result = await db.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 10",
      [req.session.userId]
    );

    const orders = result.rows.map(order => {
      // ✅ 日付の整形（日本時間に変換）
      if (order.created_at) {
        const date = new Date(order.created_at + " UTC");
        order.created_at_local = date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      } else {
        order.created_at_local = "不明";
      }
      return order;
    });

    // ✅ マイページを表示
    res.render("mypage", { 
      title: "マイページ", 
      user: req.session.user,
      orders,
      pwdError: null,   // パスワード変更エラー（初期値）
      pwdSuccess: null  // パスワード変更成功（初期値）
    });

  } catch (err) {
    console.error("❌ マイページ注文取得エラー:", err);
    res.render("mypage", { 
      title: "マイページ", 
      user: req.session.user,
      orders: [],
      pwdError: "注文履歴の取得に失敗しました。",
      pwdSuccess: null
    });
  }
});




// ================== 審査用デモ商品ページ ==================
router.get("/products", (req, res) => {
  res.render("products", { title: "サービス内容 | $tar.io" });
});






// ================== 利用規約ページ ==================
router.get("/terms", (req, res) => {
  res.render("terms", { title: "利用規約 & SNSリンク" });
});

// ================== 管理者: 注文ステータス更新 ==================
router.get("/update-order-statuses", async (req, res) => {
  const { orderId, status } = req.body;
  const db = req.app.locals.db;

  try {
    await db.query("UPDATE orders SET status = $1 WHERE id = $2", [status, orderId]);
    console.log(`✅ 管理者が注文ID ${orderId} のステータスを「${status}」に更新しました。`);
    res.redirect("back"); // 🔁 更新後に同じページへ戻る
  } catch (err) {
    console.error("❌ ステータス更新エラー:", err);
    res.status(500).send("ステータス更新に失敗しました。");
  }
});

// ================== SMMFlare ステータス自動更新 ==================
router.get("/staff/update-order-statuses", async (req, res) => {
  const db = req.app.locals.db;

  try {
    // ✅ smm_order_id（SMMFlare注文ID）があるものを取得
    const result = await db.query(
      "SELECT id, smm_order_id, status FROM orders WHERE smm_order_id IS NOT NULL AND status != 'completed'"
    );
    const orders = result.rows;

    for (const order of orders) {
      // ✅ 正しい注文番号（SMMFlare側）で問い合わせ
      const apiRes = await smm.getOrderStatus(order.smm_order_id);
      if (apiRes.error) {
        console.log(`⚠️ 注文 ${order.smm_order_id} ステータス取得失敗: ${apiRes.error}`);
        continue;
      }

      const apiStatus = (apiRes.status || "").toLowerCase();
      let newStatus = order.status;

      if (apiStatus.includes("completed")) newStatus = "completed";
      else if (apiStatus.includes("progress")) newStatus = "inprogress";
      else if (apiStatus.includes("processing") || apiStatus.includes("pending")) newStatus = "pending";

      // ✅ ステータス変更がある場合のみDB更新
      if (newStatus !== order.status) {
        await db.query("UPDATE orders SET status = $1 WHERE id = $2", [
          newStatus,
          order.id
        ]);
        console.log(`✅ 注文 ${order.smm_order_id} を ${newStatus} に更新`);
      }
    }

    res.send("✅ SMMFlareの最新ステータスに同期しました");
  } catch (err) {
    console.error("❌ ステータス更新エラー:", err);
    res.status(500).send("更新に失敗しました");
  }
});

// ================== パスワードリセット ==================

// パスワードリセット（入力ページ）
router.get("/forgot", (req, res) => {
  res.render("forgot", { 
    title: "パスワードリセット", 
    error: null, 
    success: null 
  });
});

// パスワードリセット（リンク送信）
router.post("/forgot", async (req, res) => {
  const { email } = req.body;
  const db = req.app.locals.db;

  // ランダムトークン生成
  const token = crypto.randomBytes(20).toString("hex");
  // ✅ expiresを秒単位に修正
  const expires = Math.floor(Date.now() / 1000) + 3600; // 1時間後

  try {
    // ✅ PostgreSQLは to_timestamp() を使う
    const result = await db.query(
      "UPDATE users SET reset_token=$1, reset_expires=to_timestamp($2) WHERE email=$3 RETURNING *",
      [token, expires, email]
    );

    if (result.rowCount === 0) {
      return res.render("forgot", { 
        title: "パスワードリセット", 
        error: "このメールアドレスは登録されていません。", 
        success: null 
      });
    }

    // ✅ リセットURL作成
    const resetUrl = `http://localhost:3000/reset/${token}`;

    // ✅ Gmail経由で送信
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.CONTACT_EMAIL,
        pass: process.env.CONTACT_EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.CONTACT_EMAIL,
      to: email,
      subject: "パスワードリセット",
      text: `以下のリンクから新しいパスワードを設定してください。\n\n${resetUrl}\n\nこのリンクは1時間で期限切れになります。`,
    };

    await transporter.sendMail(mailOptions);
    console.log(`📩 パスワードリセットリンク送信: ${email}`);

    res.render("forgot", { 
      title: "パスワードリセット", 
      error: null, 
      success: "リセット用リンクをメールで送信しました！" 
    });

  } catch (err) {
    console.error("❌ パスワードリセット送信エラー:", err);
    res.render("forgot", { 
      title: "パスワードリセット", 
      error: "エラーが発生しました。もう一度お試しください。", 
      success: null 
    });
  }
});

// ================== リセットページ表示 ==================
router.get("/reset/:token", async (req, res) => {
  const db = req.app.locals.db;
  const token = req.params.token;

  try {
    // ✅ PostgreSQL対応のSELECT
    const result = await db.query(
      "SELECT * FROM users WHERE reset_token=$1 AND reset_expires > NOW()",
      [token]
    );

    if (result.rows.length === 0) {
      return res.send("リンクが無効または期限切れです。");
    }

    res.render("reset", { 
      title: "新しいパスワード設定", 
      token, 
      error: null 
    });
  } catch (err) {
    console.error("❌ リセットページ取得エラー:", err);
    res.send("サーバーエラーが発生しました。");
  }
});

// ================== 新しいパスワード保存 ==================
router.post("/reset/:token", async (req, res) => {
  const { password } = req.body;
  const token = req.params.token;
  const db = req.app.locals.db;

  try {
    const hash = await bcrypt.hash(password, 10);

    // ✅ PostgreSQL対応
    const result = await db.query(
      "UPDATE users SET password_hash=$1, reset_token=NULL, reset_expires=NULL WHERE reset_token=$2 AND reset_expires > NOW() RETURNING *",
      [hash, token]
    );

    if (result.rowCount === 0) {
      return res.send("リセットに失敗しました。リンクが無効かもしれません。");
    }

    res.redirect("/login");
  } catch (err) {
    console.error("❌ パスワードリセット保存エラー:", err);
    res.send("サーバーエラーが発生しました。");
  }
});

// ================== パスワード変更（マイページ） ==================
router.post("/change-password", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const { currentPassword, newPassword, confirmPassword } = req.body;
  const db = req.app.locals.db;

  // ✅ 新しいパスワードと確認用が一致するかチェック
  if (newPassword !== confirmPassword) {
    return res.render("mypage", {
      title: "マイページ",
      user: req.session.user,
      orders: [],
      pwdError: "新しいパスワードが一致しません。",
      pwdSuccess: null
    });
  }

  try {
    // ✅ 現在のユーザー情報を取得
    const result = await db.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const user = result.rows[0];

    if (!user) {
      return res.render("mypage", {
        title: "マイページ",
        user: req.session.user,
        orders: [],
        pwdError: "ユーザーが見つかりません。",
        pwdSuccess: null
      });
    }

    // ✅ 現在のパスワードが一致するか確認
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.render("mypage", {
        title: "マイページ",
        user: req.session.user,
        orders: [],
        pwdError: "現在のパスワードが正しくありません。",
        pwdSuccess: null
      });
    }

    // ✅ 新しいパスワードをハッシュ化して更新
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.session.userId]);

    console.log(`🔑 パスワード変更成功: ${req.session.user.email}`);

    // ✅ 成功メッセージを表示
    res.render("mypage", {
      title: "マイページ",
      user: req.session.user,
      orders: [],
      pwdError: null,
      pwdSuccess: "✅ パスワードを変更しました！"
    });

  } catch (err) {
    console.error("❌ パスワード変更エラー:", err);
    res.render("mypage", {
      title: "マイページ",
      user: req.session.user,
      orders: [],
      pwdError: "サーバーエラーが発生しました。",
      pwdSuccess: null
    });
  }
});



module.exports = router;
