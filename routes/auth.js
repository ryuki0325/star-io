const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

// ユーザー登録
router.get("/register", (req, res) => {
  res.render("register", { title: "新規登録", error: null });
});

router.post("/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.render("register", { title: "新規登録", error: "全て入力してください" });

  const db = req.app.locals.db;
  const hash = bcrypt.hashSync(password, 10);

  db.run(
    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
    [email, hash],
    function (err) {
      if (err) {
        console.error(err);
        return res.render("register", { title: "新規登録", error: "登録に失敗しました" });
      }
      res.redirect("/login");
    }
  );
});

// ログイン
router.get("/login", (req, res) => {
  res.render("login", { title: "ログイン", error: null });
});

router.post("/login", (req, res) => {
  const { email, password } = req.body;
  const db = req.app.locals.db;

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err || !user) return res.render("login", { title: "ログイン", error: "ユーザーが見つかりません" });

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.render("login", { title: "ログイン", error: "パスワードが間違っています" });
    }

    // セッションに保存
    req.session.userId = user.id;
    res.redirect("/mypage");
  });
});

// ログアウト
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

module.exports = router;