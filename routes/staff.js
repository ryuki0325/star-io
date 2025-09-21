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
router.get("/users", (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;
  const q = req.query.q || "";

  db.all("SELECT id, email, balance, created_at FROM users WHERE email LIKE ? ORDER BY id DESC", 
    [`%${q}%`], 
    (err, users) => {
      res.render("staff_users", { title: "アカウント管理", users: users || [], q });
    }
  );
});

// ===== 残高調整 =====
router.post("/users/:id/balance", (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;
  const { id } = req.params;
  const { amount } = req.body;

  db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [amount, id], (err) => {
    if (err) return res.send("エラーが発生しました");
    res.redirect("/staff/users?q=");
  });
});

// ===== クーポン発行 =====
router.get("/coupons", (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;

  db.all("SELECT * FROM coupons ORDER BY id DESC", (err, coupons) => {
    res.render("staff_coupons", { title: "クーポン発行・管理", coupons: coupons || [] });
  });
});

router.post("/coupons", (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;
  const { code, discount_value, description, valid_until, max_uses } = req.body;

  db.run("INSERT INTO coupons (code, discount_value, description, valid_until, max_uses) VALUES (?,?,?,?,?)",
    [code, discount_value, description, valid_until, max_uses],
    (err) => {
      if (err) return res.send("クーポン作成に失敗しました");
      res.redirect("/staff/coupons");
    }
  );
});

// ===== ユーザー購入履歴 =====
router.get("/user/:id/orders", (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;

  db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", [req.params.id], (err, orders) => {
    if (err) return res.send("注文履歴の取得に失敗しました");

    db.get("SELECT id, email FROM users WHERE id = ?", [req.params.id], (err2, user) => {
      if (err2 || !user) return res.send("ユーザーが見つかりません");

      res.render("staff_user_orders", { 
        title: `購入履歴 - ${user.email}`, 
        user, 
        orders 
      });
    });
  });
});

// ===== ユーザー編集 =====
router.get("/user/:id/edit", (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  const db = req.app.locals.db;

  db.get("SELECT * FROM users WHERE id = ?", [req.params.id], (err, user) => {
    if (err || !user) return res.send("ユーザーが見つかりません");

    db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 10", [req.params.id], (err, orders) => {
      if (err) orders = [];
      res.render("staff_edit_user", { title: "ユーザー編集", user, orders });
    });
  });
});

router.post("/user/:id/edit", (req, res) => {
  if (!req.session.isStaff) return res.redirect("/staff/login");
  
  let balance = parseFloat(req.body.balance);
  if (isNaN(balance)) balance = 0;
  balance = Math.round(balance * 100) / 100;

  const db = req.app.locals.db;
  db.run("UPDATE users SET balance = ? WHERE id = ?", [balance, req.params.id], (err) => {
    if (err) return res.send("更新に失敗しました");
    res.redirect("/staff/users");
  });
});

// ===== ログアウト =====
router.get("/logout", (req, res) => {
  req.session.isStaff = false;
  res.redirect("/staff/login");
});

module.exports = router;