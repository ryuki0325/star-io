const express = require("express");
const router = express.Router();
const Announcement = require("../models/announcementModel");

// ===== スタッフログインページ =====
router.get("/login", (req, res) => {
  res.render("staff_login", { title: "スタッフログイン", error: null });
});

// ===== スタッフログイン処理 =====
router.post("/login", (req, res) => {
  const { password } = req.body;
  if (password === process.env.STAFF_PASS) {
    req.session.isStaff = true;
    return res.redirect("/staff/dashboard");
  }
  res.render("staff_login", { title: "スタッフログイン", error: "パスワードが違います。" });
});


// ===== ダッシュボード =====
router.get("/dashboard", (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  res.render("staff_dashboard", { title: "スタッフダッシュボード" });
});

// ===== アカウント検索 =====
router.get("/users", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;
  const q = req.query.q || "";

  try {
    const result = await db.query(
      "SELECT id, email, balance, created_at FROM users WHERE email LIKE $1 ORDER BY id DESC",
      [`%${q}%`]
    );
    res.render("staff_users", { title: "アカウント管理", users: result.rows || [], q });
  } catch (err) {
    console.error("❌ staff/users エラー:", err);
    res.render("staff_users", { title: "アカウント管理", users: [], q, error: "データ取得に失敗しました" });
  }
});

// ===== 残高調整 =====
router.post("/users/:id/balance", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;
  const { id } = req.params;
  const { amount } = req.body;

  try {
    await db.query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [amount, id]
    );
    res.redirect("/staff/users?q=");
  } catch (err) {
    console.error("❌ 残高調整エラー:", err);
    res.status(500).send("エラーが発生しました");
  }
});

// ===== クーポン発行・管理 =====
router.get("/coupons", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;

  try {
    const result = await db.query("SELECT * FROM coupons ORDER BY id DESC");
    res.render("staff_coupons", { title: "クーポン発行・管理", coupons: result.rows || [] });
  } catch (err) {
    console.error("❌ クーポン一覧取得エラー:", err);
    res.render("staff_coupons", { title: "クーポン発行・管理", coupons: [], error: "データ取得に失敗しました" });
  }
});

router.post("/coupons", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;
  const { code, discount_value, description, valid_until, max_uses } = req.body;

  try {
    await db.query(
      "INSERT INTO coupons (code, discount_value, description, valid_until, max_uses) VALUES ($1, $2, $3, $4, $5)",
      [code, discount_value, description, valid_until, max_uses]
    );
    res.redirect("/staff/coupons");
  } catch (err) {
    console.error("❌ クーポン作成エラー:", err);
    res.status(500).send("クーポン作成に失敗しました");
  }
});

// ===== 全ユーザー購入履歴 =====
router.get("/orders", async (req, res) => {
  try {
    if (!req.session.isStaff) return res.redirect("/staff/login");

    const db = req.app.locals.db;
    const result = await db.query(`
      SELECT 
        orders.id,
        orders.service_id,
        orders.service_name,
        orders.link,
        orders.quantity,
        orders.price_jpy AS price,     -- ✅ 修正ポイント！
        orders.created_at,
        users.email AS user_email
      FROM orders
      JOIN users ON orders.user_id = users.id
      ORDER BY orders.created_at DESC
    `);

    res.render("staff_orders", { 
      title: "全ユーザー購入履歴", 
      orders: result.rows 
    });
  } catch (err) {
    console.error("❌ staff/orders エラー:", err);
    res.status(500).send("サーバーエラーが発生しました");
  }
});

// ===== ユーザー購入履歴 =====
router.get("/user/:id/orders", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;

  try {
    // 注文履歴を取得
    const ordersResult = await db.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC",
      [req.params.id]
    );
    const orders = ordersResult.rows;

    // ユーザー情報を取得
    const userResult = await db.query(
      "SELECT id, email FROM users WHERE id = $1",
      [req.params.id]
    );
    const user = userResult.rows[0];

    if (!user) {
      return res.send("ユーザーが見つかりません");
    }

    // ビューに渡す
    res.render("staff_user_orders", {
      title: `購入履歴 - ${user.email}`,
      user,           // ← user.email や user.id を使える
      userId: user.id, // ← EJS 側で <%= userId %> が使えるように追加
      orders,
    });
  } catch (err) {
    console.error("❌ 注文履歴取得エラー:", err);
    res.status(500).send("注文履歴の取得に失敗しました");
  }
});

// ===== 利益率計算 =====
router.get("/profits", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  const db = req.app.locals.db;
  const { start, end, platform, user_search } = req.query;

  try {
    let conditions = [];
    let params = [];
    let paramIndex = 1;

    // 期間絞り込み
    if (start && end) {
      conditions.push(`orders.created_at BETWEEN $${paramIndex++} AND $${paramIndex++}`);
      params.push(start, end);
    }

    // 商品カテゴリ（例: TikTok, Instagram, Twitter, YouTube）
    if (platform && platform !== "all") {
      conditions.push(`orders.service_name ILIKE $${paramIndex++}`);
      params.push(`%${platform}%`);
    }

    // ユーザー検索
    if (user_search) {
      conditions.push(`(users.email ILIKE $${paramIndex} OR CAST(users.id AS TEXT) ILIKE $${paramIndex})`);
      params.push(`%${user_search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      SELECT 
        orders.id,
        orders.user_id,
        orders.service_name,
        orders.quantity,
        orders.price_jpy,
        orders.smm_cost_jpy,
        orders.customer_deposit_jpy,  -- ★追加：お客様入金額
        orders.extra_cost_jpy,        -- ★追加：使用費
        orders.created_at,
        users.email AS user_email,
        (orders.price_jpy - COALESCE(orders.smm_cost_jpy, 0)) AS profit
      FROM orders
      JOIN users ON orders.user_id = users.id
      ${whereClause}
      ORDER BY orders.created_at DESC
    `;

    const result = await db.query(query, params);

    const rate = 150; // 円換算：1ドル = 150円（仮）

    const formatted = result.rows.map(o => {
      const costJpy = o.smm_cost_jpy || 0;
      const profit = o.price_jpy - costJpy;
      const margin = o.price_jpy ? (profit / o.price_jpy) * 100 : 0;

      return {
        ...o,
        smm_cost_usd: costJpy ? (costJpy / rate).toFixed(2) : "0.00", // 仕入れ価格($)
        profit: profit.toFixed(0),
        margin: margin.toFixed(1), // 利益率(%)
      };
    });

    const totalProfit = formatted
      .reduce((sum, o) => sum + parseFloat(o.profit), 0)
      .toFixed(0);

    res.render("staff_profits", {
      title: "利益一覧",
      orders: formatted,
      totalProfit,
      start,
      end,
      platform,
      user_search
    });
  } catch (err) {
    console.error("❌ 利益計算エラー:", err);
    res.status(500).send("利益計算に失敗しました");
  }
});

// ===== 利益：お客様入金額・使用費の更新 =====
router.post("/profits/:id/update-extra", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  const db = req.app.locals.db;
  const { id } = req.params;
  let { customer_deposit_jpy, extra_cost_jpy } = req.body;

  // 数値に変換しておく
  customer_deposit_jpy = parseInt(customer_deposit_jpy || "0", 10);
  extra_cost_jpy = parseInt(extra_cost_jpy || "0", 10);

  try {
    await db.query(
      `UPDATE orders
       SET customer_deposit_jpy = $1,
           extra_cost_jpy       = $2
       WHERE id = $3`,
      [customer_deposit_jpy, extra_cost_jpy, id]
    );
    res.redirect("/staff/profits");
  } catch (err) {
    console.error("❌ 利益追加情報更新エラー:", err);
    res.status(500).send("更新に失敗しました");
  }
});

// ===== 利益CSV出力 =====
router.get("/profits/csv", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  const db = req.app.locals.db;
  const { start, end, platform, user_search } = req.query;

  try {
    let conditions = [];
    let params = [];
    let paramIndex = 1;

    if (start && end) {
      conditions.push(`orders.created_at BETWEEN $${paramIndex++} AND $${paramIndex++}`);
      params.push(start, end);
    }

    if (platform && platform !== "all") {
      conditions.push(`orders.service_name ILIKE $${paramIndex++}`);
      params.push(`%${platform}%`);
    }

    if (user_search) {
      conditions.push(`(users.email ILIKE $${paramIndex} OR CAST(users.id AS TEXT) ILIKE $${paramIndex})`);
      params.push(`%${user_search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      SELECT 
        orders.service_name,
        orders.quantity,
        orders.price_jpy,
        orders.smm_cost_jpy,
        orders.customer_deposit_jpy,
        orders.extra_cost_jpy,
        orders.created_at
      FROM orders
      JOIN users ON orders.user_id = users.id
      ${whereClause}
      ORDER BY orders.created_at DESC
    `;

    const result = await db.query(query, params);

    const rate = 150; // 1ドル = 150円（仮）

    // ヘッダー行
    let csv = "サービス名,数量,販売価格(円),仕入れ価格(円),仕入れ価格($),利益率(%),日付,お客様入金額,使用費\n";

    result.rows.forEach(row => {
      const price = row.price_jpy || 0;
      const costJpy = row.smm_cost_jpy || 0;
      const profit = price - costJpy;
      const margin = price ? ((profit / price) * 100).toFixed(1) : "0.0";
      const costUsd = costJpy ? (costJpy / rate).toFixed(2) : "0.00";
      const dateStr = row.created_at.toISOString().slice(0, 10); // YYYY-MM-DD

      const line = [
        `"${row.service_name || ""}"`,   // サービス名
        row.quantity || 0,               // 数量
        price,                           // 販売価格(円)
        costJpy,                         // 仕入れ価格(円)
        costUsd,                         // 仕入れ価格($)
        margin,                          // 利益率(%)
        dateStr,                         // 日付
        row.customer_deposit_jpy || 0,   // お客様入金額
        row.extra_cost_jpy || 0          // 使用費
      ].join(",");

      csv += line + "\n";
    });

    const bom = "\uFEFF"; // Excel用BOM

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"profits.csv\"");

    res.send(bom + csv);
  } catch (err) {
    console.error("❌ 利益CSV出力エラー:", err);
    res.status(500).send("CSV出力に失敗しました");
  }
});

// ===== SMM残高ページ =====
router.get("/balance", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  // ✅ 関数名を getBalance に修正
  const { getBalance } = require("../lib/smmClient");
  const smmBalance = await getBalance();

  res.render("staff_balance", {
    title: "SMM残高",
    smmBalance,
  });
});

// ===== SMM入金ページ =====
router.get("/smm-deposit", (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  res.render("staff_smm_deposit", { title: "SMM入金ページ" });
});

// ===== アフィリエイト履歴一覧（スタッフ用） =====
router.get("/affiliate", async (req, res) => {
  if (!req.session.isStaff) {
    return res.redirect("/staff/login");
  }

  const db = req.app.locals.db;

  try {
    const result = await db.query(
      `SELECT 
         a.id,
         a.created_at,
         a.referrer_id,
         ref.email   AS referrer_email,
         a.user_id,
         u.email     AS user_email,
         a.amount,
         a.reward
       FROM affiliate_logs a
       LEFT JOIN users ref ON ref.id = a.referrer_id
       LEFT JOIN users u   ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT 200`
    );

    const logs = result.rows;

    res.render("staff_affiliate", {
      title: "アフィリエイト管理（スタッフ）",
      logs
    });

  } catch (err) {
    console.error("❌ スタッフ用アフィリエイト一覧エラー:", err);
    res.status(500).send("アフィリエイト履歴の取得に失敗しました。");
  }
});

// ===== ユーザー編集 =====
router.get("/user/:id/edit", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;

  try {
    // ユーザー取得
    const userResult = await db.query(
      "SELECT * FROM users WHERE id = $1",
      [req.params.id]
    );
    const user = userResult.rows[0];

    if (!user) {
      return res.send("ユーザーが見つかりません");
    }

    // 注文履歴（直近10件）
    const ordersResult = await db.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 10",
      [req.params.id]
    );
    const orders = ordersResult.rows;

    res.render("staff_edit_user", {
      title: "ユーザー編集",
      user,
      orders,
    });
  } catch (err) {
    console.error("❌ ユーザー編集画面エラー:", err);
    res.status(500).send("データ取得に失敗しました");
  }
});

router.post("/user/:id/edit", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  let balance = parseFloat(req.body.balance);
  if (isNaN(balance)) balance = 0;
  balance = Math.round(balance * 100) / 100; // 小数点2桁まで丸め

  const db = req.app.locals.db;

  try {
    await db.query(
      "UPDATE users SET balance = $1 WHERE id = $2",
      [balance, req.params.id]
    );
    res.redirect("/staff/users");
  } catch (err) {
    console.error("❌ ユーザー残高更新エラー:", err);
    res.status(500).send("更新に失敗しました");
  }
});

// 📊 利益データを返すAPI（SMMサービスID + 正確な日付付き）
router.get("/api/profit", async (req, res) => {
  const db = req.app.locals.db;
  const { start, end } = req.query;

  try {
    const result = await db.query(
      `SELECT 
         orders.service_id,                       -- ✅ ← SMMサービスIDを取得！
         orders.user_id AS user,
         orders.service_name AS service,
         orders.quantity AS qty,
         orders.price_jpy AS price,
         COALESCE(orders.smm_cost_jpy, 0) AS cost,
         (orders.price_jpy - COALESCE(orders.smm_cost_jpy, 0)) AS profit,
         orders.created_at                        -- ✅ ← 正確な日付（時刻付き）
       FROM orders
       WHERE orders.created_at BETWEEN $1 AND $2
       ORDER BY orders.created_at DESC`,
      [start + " 00:00:00", end + " 23:59:59"]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ 利益APIエラー:", err);
    res.status(500).json({ error: "サーバーエラー" });
  }
});

// ===== お知らせ管理（一覧 + 追加） =====
router.get("/announcements", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  try {
    const announcements = await Announcement.getAll();
    res.render("staff_announcements", {
      title: "お知らせ管理",
      announcements,
      success: req.query.success || null,
      error: req.query.error ? "お知らせの更新に失敗しました。" : null
    });
  } catch (err) {
    console.error("❌ スタッフお知らせ一覧エラー:", err);
    res.render("staff_announcements", {
      title: "お知らせ管理",
      announcements: [],
      success: null,
      error: "お知らせの取得に失敗しました。"
    });
  }
});

// ===== お知らせ追加 =====
router.post("/announcements", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  const { title, body } = req.body;

  try {
    if (!title || !body) {
      return res.redirect("/staff/announcements?error=1");
    }
    await Announcement.create(title, body);
    res.redirect("/staff/announcements?success=1");
  } catch (err) {
    console.error("❌ お知らせ追加エラー:", err);
    res.redirect("/staff/announcements?error=1");
  }
});

// ===== お知らせ削除 =====
router.post("/announcements/:id/delete", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  try {
    await Announcement.delete(req.params.id);
    res.redirect("/staff/announcements?success=1");
  } catch (err) {
    console.error("❌ お知らせ削除エラー:", err);
    res.redirect("/staff/announcements?error=1");
  }
});

// ===== 出金申請一覧（スタッフ用） =====
router.get("/withdraw", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  const db = req.app.locals.db;

  try {
    const result = await db.query(
      `SELECT 
         w.*,
         u.email AS user_email
       FROM withdraw_requests w
       LEFT JOIN users u ON u.id = w.user_id
       ORDER BY 
         CASE WHEN w.status = 'pending' THEN 0 ELSE 1 END,
         w.created_at DESC`
    );

    const requests = result.rows;
    const pendingCount = requests.filter(r => r.status === "pending").length;

    res.render("staff_withdraw", {
      title: "出金申請一覧",
      requests,
      pendingCount
    });

  } catch (err) {
    console.error("❌ 出金申請一覧エラー:", err);
    res.status(500).send("出金申請の取得に失敗しました。");
  }
});

// ===== 出金申請 承認 =====
router.post("/withdraw/:id/approve", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  const db = req.app.locals.db;
  const id = req.params.id;

  try {
    await db.query(
      "UPDATE withdraw_requests SET status = 'approved' WHERE id = $1",
      [id]
    );
    res.redirect("/staff/withdraw");
  } catch (err) {
    console.error("❌ 出金申請承認エラー:", err);
    res.status(500).send("承認に失敗しました。");
  }
});

// ===== 出金申請 却下 =====
router.post("/withdraw/:id/reject", async (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");

  const db = req.app.locals.db;
  const id = req.params.id;

  try {
    await db.query(
      "UPDATE withdraw_requests SET status = 'rejected' WHERE id = $1",
      [id]
    );
    res.redirect("/staff/withdraw");
  } catch (err) {
    console.error("❌ 出金申請却下エラー:", err);
    res.status(500).send("却下に失敗しました。");
  }
});

// ===== ログアウト =====
router.get("/logout", (req, res) => {
  req.session.isStaff = false;
  res.redirect("/staff/login");
});

module.exports = router;
