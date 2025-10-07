require("dotenv").config();
const express = require("express");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const router = express.Router();
const smm = require("../lib/smmClient");

// 優先アプリ
const priorityApps = ["TikTok", "Instagram", "YouTube", "Twitter", "Spotify", "Telegram", "Twitch"];

// 除外アプリ
const excludedApps = [
  "------------","Article",
  "CoinsGods","DA30＋","DA50＋","DA70＋","EDU","EMERGENCY","Exploit",
  "Forum","FreshCoins","Keyword","Kick","Kick.com","LOCO.GG",
  "Mentimeter.com","MixCloud","PinterestPremium","Quora",
  "Reverbenation","Reverbnation","S1","S2","Shazam","Shopee","Social","Tidal","Trovo","Wiki"
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
router.get("/", async (req, res) => {   // ← async を追加！
  const apps = ["TikTok","Instagram","YouTube","Twitter","Spotify","Telegram","Twitch","Facebook","Reddit"];
  const db = req.app.locals.db;

  // アイコンマップ
  const emojiMap = {
    TikTok: "🎵",
    Instagram: "📸",
    YouTube: "▶️",
    Twitter: "🐦", // Xは🐦か✖️でもOK
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
    const orders = result.rows;

    res.render("dashboard", { 
      title: "ホーム", 
      apps, 
      user: req.session.user, 
      orders,
      emojiMap
    });
  } catch (err) {
    console.error("❌ ダッシュボード注文取得エラー:", err);
    res.render("dashboard", { 
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

router.post("/signup", (req, res) => {
  const { email, password } = req.body;
  const db = req.app.locals.db;
  const hash = bcrypt.hashSync(password, 10);

  db.run("INSERT INTO users (email, password_hash) VALUES (?, ?)", [email, hash], function(err) {
    if (err) {
      return res.render("signup", { title: "新規登録", error: "登録に失敗しました: " + err.message });
    }
    req.session.userId = this.lastID;
    req.session.user = { id: this.lastID, email, balance: 0 };
    res.redirect("/mypage");
  });
});

// ================== ログイン / ログアウト ==================

// ログインページ表示
router.get("/login", (req, res) => {
  res.render("login", { title: "ログイン", error: null });
});

// ログイン処理
router.post("/login", async (req, res) => {   // ← async 必須
  const { email, password } = req.body;
  const db = req.app.locals.db;

  try {
    // ユーザーを検索
    const result = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];

    // ユーザーが存在しない
    if (!user) {
      return res.render("login", { 
        title: "ログイン", 
        error: "ユーザーが存在しません。" 
      });
    }

    // パスワードチェック
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render("login", { 
        title: "ログイン", 
        error: "メールアドレスまたはパスワードが間違っています。" 
      });
    }

    // ✅ セッション保存
    req.session.userId = user.id;
    req.session.user = user;

    // 管理者ログインの場合
    if (user.email === process.env.ADMIN_LOGIN_EMAIL) {
      req.session.isStaff = true;
      return res.redirect("/staff/dashboard");
    }

    // 一般ユーザーはマイページへ
    res.redirect("/mypage");
  } catch (err) {
    console.error("DBエラー:", err);
    return res.render("login", { 
      title: "ログイン", 
      error: "サーバーエラーが発生しました。" 
    });
  }
});

// ログアウト処理
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ================== 通常の（ダミー）チャージ処理 ==================
router.post("/funds", (req, res) => {
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

  db.run(
    "UPDATE users SET balance = balance + ? WHERE id = ?",
    [addAmount, req.session.userId],
    (err) => {
      if (err) {
        return res.render("funds", { 
          title: "残高チャージ", 
          user: req.session.user, 
          balance: req.session.user?.balance || 0,
          error: "残高更新に失敗しました。" 
        });
      }
      db.get("SELECT * FROM users WHERE id = ?", [req.session.userId], (err2, user) => {
        if (!err2 && user) req.session.user = user;
        res.redirect("/mypage");
      });
    }
  );
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

// ====== Stripe チャージの成功ページ ======
router.get("/funds/success", (req, res) => {
  const db = req.app.locals.db;
  const chargeAmount = req.query.amount ? parseInt(req.query.amount, 10) : null;

  db.get("SELECT balance FROM users WHERE id = ?", [req.session.userId], (err, row) => {
    res.render("funds-success", {
      title: "チャージ成功",
      user: req.session.user,
      chargeAmount: chargeAmount,
      balance: row ? row.balance : 0
    });
  });
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
  let app = normalizeAppName(s.name);
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
router.post("/redeem", (req, res) => {
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

  // クーポン検索
  db.get("SELECT * FROM coupons WHERE code = ?", [code], (err, coupon) => {
    if (err || !coupon) {
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
    if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
      return res.render("coupon", {
        title: "ギフトコード",
        user: req.session.user,
        success: null,
        error: "このコードは既に使用上限に達しています。"
      });
    }

    // 重複使用チェック
    db.get(
      "SELECT id FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?",
      [coupon.id, req.session.userId],
      (e2, redeemed) => {
        if (e2) {
          return res.render("coupon", {
            title: "ギフトコード",
            user: req.session.user,
            success: null,
            error: "サーバーエラーが発生しました。"
          });
        }
        if (redeemed) {
          return res.render("coupon", {
            title: "ギフトコード",
            user: req.session.user,
            success: null,
            error: "このコードは既に使用済みです。"
          });
        }

        // 残高付与処理
        db.run(
          "UPDATE users SET balance = balance + ? WHERE id = ?",
          [coupon.discount_value, req.session.userId],
          (e3) => {
            if (e3) {
              return res.render("coupon", {
                title: "ギフトコード",
                user: req.session.user,
                success: null,
                error: "残高更新に失敗しました。"
              });
            }

            db.run(
              "UPDATE coupons SET used_count = used_count + 1 WHERE id = ?",
              [coupon.id],
              (e4) => {
                if (e4) {
                  return res.render("coupon", {
                    title: "ギフトコード",
                    user: req.session.user,
                    success: null,
                    error: "コード適用処理に失敗しました。"
                  });
                }

                db.run(
                  "INSERT INTO coupon_redemptions (coupon_id, user_id) VALUES (?, ?)",
                  [coupon.id, req.session.userId],
                  (e5) => {
                    if (e5) {
                      return res.render("coupon", {
                        title: "ギフトコード",
                        user: req.session.user,
                        success: null,
                        error: "履歴の保存に失敗しました。"
                      });
                    }

                    // 最新のユーザー情報を取得してセッション更新
                    db.get(
                      "SELECT * FROM users WHERE id = ?",
                      [req.session.userId],
                      (e6, freshUser) => {
                        if (!e6 && freshUser) req.session.user = freshUser;

                        res.render("coupon", {
                          title: "ギフトコード",
                          user: req.session.user,
                          success: `🎁 コード「${code}」を適用しました！ ${coupon.discount_value} 円が残高に追加されました。`,
                          error: null
                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });
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

    // 残高確認
    db.get("SELECT balance FROM users WHERE id = ?", [req.session.userId], async (err, row) => {
      if (err) return res.send("サーバーエラー");
      const balance = parseFloat(row?.balance || 0);

      if (balance < amount) {
        return res.send("残高不足です");
      }

      // ✅ 残高を減算
      db.run(
        "UPDATE users SET balance = balance - ? WHERE id = ?",
        [amount, req.session.userId],
        async (err2) => {
          if (err2) return res.send("残高更新に失敗しました");

          try {
            // ✅ SMMFlare APIに注文送信
            const orderRes = await smm.createOrder(serviceId, link, quantity);

            // ✅ 注文をDB保存
            db.run(
              "INSERT INTO orders (user_id, service_id, service_name, link, quantity, price_jpy) VALUES (?,?,?,?,?,?)",
              [req.session.userId, serviceId, svc.name, link, quantity, amount],
              function (err3) {
                if (err3) return res.send("注文保存に失敗しました");

                res.render("order_success", {
                  title: "注文完了",
                  orderId: orderRes.order,     // APIから返ってきた注文ID
                  serviceName: svc.name,
                  quantity,
                  amount: amount.toFixed(2),   // 表示は小数2桁
                  balance: (balance - amount).toFixed(2) // 更新後残高
                });
              }
            );
          } catch (apiErr) {
            console.error("SMMFlare注文エラー:", apiErr.response?.data || apiErr.message);
            res.send("注文送信に失敗しました");
          }
        }
      );
    });
  } catch (e) {
    console.error("注文処理エラー:", e.message);
    res.send("サーバーエラー");
  }
});

// ================== 注文履歴 ==================
router.get("/orders", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const db = req.app.locals.db;

  db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", [req.session.userId], (err, orders) => {
    if (err) orders = [];

    orders = orders.map(order => {
      if (order.created_at) {
        const date = new Date(order.created_at + " UTC");
        order.created_at_local = date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      } else {
        order.created_at_local = "不明";
      }
      return order;
    });

    res.render("orders", { title: "注文履歴", orders });
  });
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
router.get("/mypage", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const db = req.app.locals.db;

  db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 10", [req.session.userId], (err, orders) => {
    if (err) orders = [];
  res.render("mypage", { 
  title: "マイページ", 
  user: req.session.user,
  orders,
  pwdError: null,    // ✅ カンマの位置に注意
  pwdSuccess: null   // ✅ 最後の行はカンマ無し
    });
  });
});





// ================== 審査用デモ商品ページ ==================
router.get("/products", (req, res) => {
  res.render("products", { title: "サービス内容 | $tar.io" });
});






// ================== 利用規約ページ ==================
router.get("/terms", (req, res) => {
  res.render("terms", { title: "利用規約 & SNSリンク" });
});

// ================== パスワードリセット==================
// パスワードリセット（入力ページ）
router.get("/forgot", (req, res) => {
  res.render("forgot", { title: "パスワードリセット", error: null, success: null });
});

// パスワードリセット（リンク送信）
router.post("/forgot", (req, res) => {
  const { email } = req.body;
  const db = req.app.locals.db;

  // ランダムトークン生成
  const token = crypto.randomBytes(20).toString("hex");
  const expires = Date.now() + 3600000; // 1時間有効

  db.run(
    "UPDATE users SET reset_token=?, reset_expires=? WHERE email=?",
    [token, expires, email],
    function (err) {
      if (err || this.changes === 0) {
        return res.render("forgot", { title: "パスワードリセット", error: "メールアドレスが見つかりません。", success: null });
      }

      // リセットURL作成
      const resetUrl = `http://localhost:3000/reset/${token}`;

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
        to: email,  // ユーザー宛に送信
        subject: "パスワードリセット",
        text: `以下のリンクから新しいパスワードを設定してください。\n\n${resetUrl}\n\n有効期限は1時間です。`
      };

      transporter.sendMail(mailOptions, (err) => {
        if (err) {
          console.error("メール送信エラー:", err);
          return res.render("forgot", { title: "パスワードリセット", error: "メール送信に失敗しました。", success: null });
        }
        res.render("forgot", { title: "パスワードリセット", error: null, success: "リセット用リンクをメールで送信しました！" });
      });
    }
  );
});

// リセットページ表示
router.get("/reset/:token", (req, res) => {
  const db = req.app.locals.db;
  db.get(
    "SELECT * FROM users WHERE reset_token=? AND reset_expires > ?",
    [req.params.token, Date.now()],
    (err, user) => {
      if (!user) return res.send("リンクが無効または期限切れです。");
      res.render("reset", { title: "新しいパスワード設定", token: req.params.token, error: null });
    }
  );
});

// 新しいパスワード保存
router.post("/reset/:token", (req, res) => {
  const { password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  const db = req.app.locals.db;

  db.run(
    "UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL WHERE reset_token=? AND reset_expires > ?",
    [hash, req.params.token, Date.now()],
    function (err) {
      if (err || this.changes === 0) {
        return res.send("リセットに失敗しました。リンクが無効かもしれません。");
      }
      res.redirect("/login");
    }
  );
});

// ================== パスワード変更（マイページ） ==================
router.post("/change-password", (req, res) => {
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

  db.get("SELECT * FROM users WHERE id = ?", [req.session.userId], async (err, user) => {
    if (err || !user) {
      return res.render("mypage", {
        title: "マイページ",
        user: req.session.user,
        orders: [],
        pwdError: "ユーザーが見つかりません。",
        pwdSuccess: null
      });
    }

    // 現在のパスワード確認
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

    // 新しいパスワードを保存
    const hash = bcrypt.hashSync(newPassword, 10);
    db.run("UPDATE users SET password_hash=? WHERE id=?", [hash, req.session.userId], (e2) => {
      if (e2) {
        return res.render("mypage", {
          title: "マイページ",
          user: req.session.user,
          orders: [],
          pwdError: "パスワード更新に失敗しました。",
          pwdSuccess: null
        });
      }

      res.render("mypage", {
        title: "マイページ",
        user: req.session.user,
        orders: [],
        pwdError: null,
        pwdSuccess: "✅ パスワードを変更しました！"
      });
    });
  });
});



module.exports = router;
