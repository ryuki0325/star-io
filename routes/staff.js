const express = require("express");
const router = express.Router();

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

router.get('/profits', async (req, res) => {
  const { start, end, search } = req.query;

  let query = {};
  if (start && end) {
    query.created_at = { $gte: start, $lte: end };
  }
  if (search) {
    query.$or = [
      { customer_name: new RegExp(search, 'i') },
      { service_name: new RegExp(search, 'i') }
    ];
  }

  const orders = await Order.find(query);

  const profitList = orders.map(o => ({
    ...o._doc,
    profit: o.price_site - o.price_smm
  }));

  const totalProfit = profitList.reduce((sum, o) => sum + o.profit, 0);

  res.render('admin/profits', {
    orders: profitList,
    totalProfit,
    start,
    end,
    search
  });
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

// ===== ログアウト =====
router.get("/logout", (req, res) => {
  req.session.isStaff = false;
  res.redirect("/staff/login");
});

module.exports = router;
