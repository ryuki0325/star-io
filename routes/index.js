require("dotenv").config();
const express = require("express");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const router = express.Router();
const smm = require("../lib/smmClient");

// 👑 おすすめサービスIDを.envから読み込み
const recommendedServices = (process.env.RECOMMENDED_SERVICES || "")
  .split(",")
  .map(id => parseInt(id.trim(), 10))
  .filter(id => !isNaN(id));

// 優先アプリ
const priorityApps = ["TikTok", "Instagram", "YouTube", "Twitter", "Spotify", "Telegram", "Twitch"];

// 除外アプリ
const excludedApps = [
  "------------","Article","Blog","CNTOKEN","Cancel","Category",
  "CoinsGods","DA30＋","DA50＋","DA70＋","EDU","EMERGENCY","Exploit",
  "Forum","FreshCoins","Keyword","Kick","Kick.com","LOCO.GG","Likee",
  "Mentimeter.com","MixCloud","Mixed","PinterestPremium","Quora","Rnal",
  "Reverbenation","Reverbnation","S1","S2","Shazam","Shopee","Social",
  "The","Tidal","Trovo","Wiki"
];

// ================== ホーム ==================
router.get("/", async (req, res) => {
  const apps = ["TikTok","Instagram","YouTube","Twitter","Spotify","Telegram","Twitch","Facebook","Reddit"];
  const db = req.app.locals.db;

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

  if (!req.session.userId) {
    return res.render("dashboard", { 
      title: "ホーム", 
      apps, 
      user: null, 
      orders: [],
      emojiMap
    });
  }

  try {
    const result = await db.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC",
      [req.session.userId]
    );
    return res.render("dashboard", { 
      title: "ホーム", 
      apps, 
      user: req.session.user, 
      orders: result.rows,
      emojiMap
    });
  } catch (e) {
    console.error("ホーム取得エラー:", e);
    return res.render("dashboard", { 
      title: "ホーム", 
      apps, 
      user: req.session.user, 
      orders: [],
      emojiMap
    });
  }
});


// ================== サインアップ ==================
router.get("/signup", (req, res) => {
  res.render("signup", { title: "新規登録", error: null });
});

router.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  const db = req.app.locals.db;
  const hash = bcrypt.hashSync(password, 10);

  try {
    const result = await db.query(
      "INSERT INTO users (email, password_hash, balance) VALUES ($1, $2, $3) RETURNING id",
      [email, hash, 0]
    );

    const userId = result.rows[0].id;
    req.session.userId = userId;
    req.session.user = { id: userId, email, balance: 0 };

    res.redirect("/mypage");

  } catch (err) {
    if (err.code === "23505") {
      return res.render("signup", {
        title: "新規登録",
        error: "既にアカウントが存在します。"
      });
    }
    console.error("サインアップエラー:", err);
    res.render("signup", {
      title: "新規登録",
      error: "登録に失敗しました。もう一度お試しください。"
    });
  }
});


// ================== ログイン / ログアウト ==================
router.get("/login", (req, res) => {
  res.render("login", { title: "ログイン", error: null });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await req.app.locals.db.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];

    if (!user) {
      return res.render("login", {
        title: "ログイン",
        error: "ユーザーが存在しません。"
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render("login", {
        title: "ログイン",
        error: "メールアドレスまたはパスワードが間違っています。"
      });
    }

    req.session.userId = user.id;
    req.session.user = user;

    if (user.email === process.env.ADMIN_LOGIN_EMAIL) {
      req.session.isStaff = true;
      return res.redirect("/staff/dashboard");
    }

    res.redirect("/mypage");
  } catch (err) {
    console.error("ログインエラー:", err);
    res.render("login", {
      title: "ログイン",
      error: "サーバーエラーが発生しました。"
    });
  }
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ================== 残高チャージ ==================
router.get("/funds", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  res.render("funds", { 
    title: "残高チャージ", 
    user: req.session.user,
    balance: req.session.user?.balance || 0,
    error: null
  });
});

// ================== 通常の（ダミー）チャージ処理 ==================
router.post("/funds", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const db = req.app.locals.db;
  const addAmount = parseInt(req.body.amount, 10);

  if (isNaN(addAmount) || addAmount <= 0) {
    return res.render("funds", { 
      title: "残高チャージ", 
      user: req.session.user, 
      balance: req.session.user?.balance || 0,
      error: "正しい金額を入力してください。" 
    });
  }

  try {
    await db.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [addAmount, req.session.userId]);
    const result = await db.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    req.session.user = result.rows[0];
    return res.redirect("/mypage");
  } catch (e) {
    return res.render("funds", { 
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
      success_url: `https://star-io-hc9c.onrender.com/funds/success?amount=${amount}`,
      cancel_url: `https://star-io-hc9c.onrender.com/funds/cancel`,
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

// ====== Stripe チャージの成功ページ ======
// ====== Stripe チャージの成功ページ ======
router.get("/funds/success", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const db = req.app.locals.db;
  const chargeAmount = req.query.amount ? parseInt(req.query.amount, 10) : null;

  try {
    // DBから最新のユーザー情報を取得
    const result = await db.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const row = result.rows[0];

    if (row) {
      // ✅ セッションのユーザー情報を最新化
      req.session.user = row;
    }

    return res.render("funds-success", {
      title: "チャージ成功",
      user: req.session.user,
      chargeAmount,
      balance: row ? Math.floor(row.balance) : 0
    });
  } catch (err) {
    console.error("funds/success エラー:", err);
    return res.render("funds-success", {
      title: "チャージ成功",
      user: req.session.user,
      chargeAmount,
      balance: 0
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
  const app = normalizeAppName(s.name);
  const type = detectType(s.name);

  // 除外条件
  if (
    excludedApps.includes(app) || /^[0-9]+$/.test(app) || /^[-]+$/.test(app) ||
    /\p{Emoji}/u.test(app) || /^[A-Z]{2,3}$/i.test(app) ||
    /(flag|country|refill|cancel|cheap|test|trial|bonus|package|mix)/i.test(s.name)
  ) {
    return;
  }

  if (!grouped[app]) grouped[app] = {};
  if (!grouped[app][type]) grouped[app][type] = [];

  // 1ドルあたりの円換算レート
  const JPY_RATE = parseFloat(process.env.JPY_RATE || "150");

  // APIレートを円換算
  s.baseRate = parseFloat(s.rate) * JPY_RATE;

  // 倍率を適用
  s.rate = applyPriceMultiplier(s.baseRate);

  // 👑おすすめ判定
  const serviceId = parseInt(s.service, 10);
  if (recommendedServices.includes(serviceId)) {
    s.name = "👑おすすめ " + s.name;
  }

  // まとめて格納
  grouped[app][type].push(s);
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
    selectedApp: req.query.app || "",
    balance: Number(req.session.user?.balance || 0).toFixed(2)
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
    // クーポン検索
    const result = await db.query("SELECT * FROM coupons WHERE code = $1", [code]);
    const coupon = result.rows[0];

    if (!coupon) {
      return res.render("coupon", {
        title: "ギフトコード",
        user: req.session.user,
        success: null,
        error: "無効なコードです。"
      });
    }

    // 有効期限チェック
    if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) {
      return res.render("coupon", {
        title: "ギフトコード",
        user: req.session.user,
        success: null,
        error: "このコードは期限切れです。"
      });
    }

    // 使用回数上限チェック
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
      return res.render("coupon", {
        title: "ギフトコード",
        user: req.session.user,
        success: null,
        error: "このコードは既に使用上限に達しています。"
      });
    }

    // 重複使用チェック
    const redeemed = await db.query(
      "SELECT id FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2",
      [coupon.id, req.session.userId]
    );
    if (redeemed.rows.length > 0) {
      return res.render("coupon", {
        title: "ギフトコード",
        user: req.session.user,
        success: null,
        error: "このコードは既に使用済みです。"
      });
    }

    // トランザクション開始
    await db.query("BEGIN");

    // 残高付与
    await db.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [
      coupon.discount_value,
      req.session.userId,
    ]);

    // クーポン使用回数更新
    await db.query("UPDATE coupons SET used_count = used_count + 1 WHERE id = $1", [coupon.id]);

    // 履歴保存
    await db.query("INSERT INTO coupon_redemptions (coupon_id, user_id) VALUES ($1, $2)", [
      coupon.id,
      req.session.userId,
    ]);

    // コミット
    await db.query("COMMIT");

    // 最新のユーザー情報を取得してセッション更新
    const freshUser = await db.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    if (freshUser.rows[0]) req.session.user = freshUser.rows[0];

    res.render("coupon", {
      title: "ギフトコード",
      user: req.session.user,
      success: `🎁 コード「${code}」を適用しました！ ${coupon.discount_value} 円が残高に追加されました。`,
      error: null
    });
  } catch (err) {
    console.error("ギフトコード適用エラー:", err);
    await db.query("ROLLBACK"); // エラー時はロールバック
    res.render("coupon", {
      title: "ギフトコード",
      user: req.session.user,
      success: null,
      error: "コード適用中にエラーが発生しました。"
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

    if (price <= 100) {
      return price * low;
    } else if (price <= 1000) {
      return price * mid;
    } else if (price <= 1600) {
      return price * high;
    } else {
      return price * top;
    }
  }

  try {
    // ✅ サービス情報を取得
    const services = await smm.getServices();
    const svc = services.find(s => s.service == serviceId);
    if (!svc) return res.send("サービスが見つかりません");

    // ✅ 為替レートを反映
    const JPY_RATE = parseFloat(process.env.JPY_RATE || "150");

    // ✅ ドル価格を円換算 → 倍率適用
    const unitRate = applyPriceMultiplier(parseFloat(svc.rate) * JPY_RATE);

    // ✅ 最終金額 (円)
    const amount = (unitRate / 1000) * Number(quantity);

    // ✅ 残高確認
    const balanceResult = await db.query("SELECT balance FROM users WHERE id = $1", [req.session.userId]);
    const balance = parseFloat(balanceResult.rows[0]?.balance || 0);

    if (balance < amount) {
      return res.send("残高不足です");
    }

    // ✅ トランザクション開始
    await db.query("BEGIN");

    // ✅ 残高を減算
    await db.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [
      amount,
      req.session.userId,
    ]);

    try {
      // ✅ SMMFlare APIに注文送信
      const orderRes = await smm.createOrder(serviceId, link, quantity);

      // ✅ 注文をDB保存
      await db.query(
        "INSERT INTO orders (user_id, service_id, service_name, link, quantity, price_jpy) VALUES ($1, $2, $3, $4, $5, $6)",
        [req.session.userId, serviceId, svc.name, link, quantity, amount]
      );

      // ✅ コミット
      await db.query("COMMIT");

      res.render("order_success", {
        title: "注文完了",
        orderId: orderRes.order,     // APIから返ってきた注文ID
        serviceName: svc.name,
        quantity,
        amount: amount.toFixed(2),   // 表示は小数2桁
        balance: (balance - amount).toFixed(2) // 更新後残高
      });

    } catch (apiErr) {
      await db.query("ROLLBACK");
      console.error("SMMFlare注文エラー:", apiErr.response?.data || apiErr.message);
      res.send("注文送信に失敗しました");
    }

  } catch (e) {
    console.error("注文処理エラー:", e.message);
    res.send("サーバーエラー");
  }
});

// ================== 注文履歴 ==================
router.get("/orders", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  try {
    const result = await req.app.locals.db.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC",
      [req.session.userId]
    );

    const orders = result.rows.map(order => {
      if (order.created_at) {
        // created_at を JST 表示に変換
        const date = new Date(order.created_at + " UTC");
        order.created_at_local = date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      } else {
        order.created_at_local = "不明";
      }
      return order;
    });

    res.render("orders", { title: "注文履歴", orders });
  } catch (err) {
    console.error("注文履歴取得エラー:", err);
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
router.post("/contact", (req, res) => {
  const { category, subcategory, orderId, email, message } = req.body;

  if (!email || !message) {
    return res.render("contact", {
      title: "お問い合わせ",
      success: null,
      error: "メールアドレスと内容は必須です。"
    });
  }

  // Nodemailer設定
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.CONTACT_EMAIL,       // Gmail アドレス
      pass: process.env.CONTACT_EMAIL_PASS,  // アプリパスワード
    },
  });

  // 送信内容
  const mailOptions = {
    from: process.env.CONTACT_EMAIL,      // 送信元（Gmailアカウント）
    to: process.env.CONTACT_EMAIL,        // 自分宛に送信
    replyTo: email,                       // ユーザーが入力したメールを返信先に
    subject: `【お問い合わせ】${category || "未選択"} - ${subcategory || "未選択"}`,
    text: `
カテゴリ: ${category}
サブカテゴリ: ${subcategory}
注文ID: ${orderId || "なし"}
送信者メール: ${email}

内容:
${message}
    `
  };

  // メール送信
  transporter.sendMail(mailOptions, (err, info) => {
    if (err) {
      console.error("メール送信エラー:", err);
      return res.render("contact", {
        title: "お問い合わせ",
        success: null,
        error: "メール送信に失敗しました。"
      });
    }
    console.log("メール送信成功:", info.response);
    res.render("contact", {
      title: "お問い合わせ",
      success: "送信が完了しました！ご記入いただいた内容を確認いたします。",
      error: null
    });
  });
});

// ================== マイページ ==================
router.get("/mypage", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const db = req.app.locals.db;

  try {
    const result = await db.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 10",
      [req.session.userId]
    );

    const orders = result.rows || [];

    res.render("mypage", { 
      title: "マイページ", 
      user: req.session.user,
      orders,
      pwdError: null,   // ✅ カンマの位置に注意
      pwdSuccess: null  // ✅ 最後はカンマ無し
    });
  } catch (err) {
    console.error("マイページ取得エラー:", err);
    res.render("mypage", { 
      title: "マイページ", 
      user: req.session.user,
      orders: [],
      pwdError: null,
      pwdSuccess: null
    });
  }
});
// ================== 利用規約ページ ==================
router.get("/terms", (req, res) => {
  res.render("terms", { title: "利用規約 & SNSリンク" });
});

// ================== パスワードリセット ==================

// パスワードリセット（入力ページ）
router.get("/forgot", (req, res) => {
  res.render("forgot", { title: "パスワードリセット", error: null, success: null });
});

// パスワードリセット（リンク送信）
router.post("/forgot", async (req, res) => {
  const { email } = req.body;
  const db = req.app.locals.db;

  // ランダムトークン生成
  const token = crypto.randomBytes(20).toString("hex");
  const expires = Date.now() + 3600000; // 1時間有効

  try {
    // ✅ ユーザー更新
    const result = await db.query(
      "UPDATE users SET reset_token=$1, reset_expires=$2 WHERE email=$3 RETURNING id",
      [token, expires, email]
    );

    if (result.rowCount === 0) {
      return res.render("forgot", { title: "パスワードリセット", error: "メールアドレスが見つかりません。", success: null });
    }

    // リセットURL作成
    const resetUrl = `https://star-io-hc9c.onrender.com/reset/${token}`;

    // Gmail経由で送信
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
      text: `以下のリンクから新しいパスワードを設定してください。\n\n${resetUrl}\n\n有効期限は1時間です。`
    };

    await transporter.sendMail(mailOptions);

    res.render("forgot", { title: "パスワードリセット", error: null, success: "リセット用リンクをメールで送信しました！" });

  } catch (err) {
    console.error("パスワードリセットエラー:", err);
    res.render("forgot", { title: "パスワードリセット", error: "処理中にエラーが発生しました。", success: null });
  }
});

// リセットページ表示
router.get("/reset/:token", async (req, res) => {
  const db = req.app.locals.db;
  try {
    const result = await db.query(
      "SELECT * FROM users WHERE reset_token=$1 AND reset_expires > $2",
      [req.params.token, Date.now()]
    );

    if (result.rowCount === 0) {
      return res.send("リンクが無効または期限切れです。");
    }

    res.render("reset", { title: "新しいパスワード設定", token: req.params.token, error: null });

  } catch (err) {
    console.error("リセットページエラー:", err);
    res.send("サーバーエラーが発生しました。");
  }
});

// 新しいパスワード保存
router.post("/reset/:token", async (req, res) => {
  const { password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  const db = req.app.locals.db;

  try {
    const result = await db.query(
      "UPDATE users SET password_hash=$1, reset_token=NULL, reset_expires=NULL WHERE reset_token=$2 AND reset_expires > $3 RETURNING id",
      [hash, req.params.token, Date.now()]
    );

    if (result.rowCount === 0) {
      return res.send("リセットに失敗しました。リンクが無効かもしれません。");
    }

    res.redirect("/login");
  } catch (err) {
    console.error("パスワード保存エラー:", err);
    res.send("サーバーエラーが発生しました。");
  }
});
  
// ================== パスワード変更（マイページ） ==================
router.post("/change-password", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const { currentPassword, newPassword, confirmPassword } = req.body;
  const db = req.app.locals.db;

  // 新しいパスワードと確認用が一致するか
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
    // ✅ ユーザー取得
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

    // ✅ 現在のパスワード確認
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

    // ✅ 新しいパスワードを保存
    const hash = bcrypt.hashSync(newPassword, 10);
    const updateResult = await db.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id",
      [hash, req.session.userId]
    );

    if (updateResult.rowCount === 0) {
      return res.render("mypage", {
        title: "マイページ",
        user: req.session.user,
        orders: [],
        pwdError: "パスワード更新に失敗しました。",
        pwdSuccess: null
      });
    }

    // ✅ 成功レスポンス
    res.render("mypage", {
      title: "マイページ",
      user: req.session.user,
      orders: [],
      pwdError: null,
      pwdSuccess: "✅ パスワードを変更しました！"
    });

  } catch (err) {
    console.error("パスワード変更エラー:", err);
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
