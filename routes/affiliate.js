const express = require("express");
const router = express.Router();

router.get("/affiliate", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  const db = req.app.locals.db;
  const userId = req.session.userId;

  try {
    // 自分の情報
    const userRes = await db.query(
      "SELECT email, referral_code, affiliate_earnings FROM users WHERE id = $1",
      [userId]
    );
    const me = userRes.rows[0];

    // ⭐ 招待したユーザー一覧（メールは取らず、idと日時だけ）
    const invitedRes = await db.query(
      `SELECT id, created_at
       FROM users
       WHERE referred_by = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    const invitedUsers = invitedRes.rows;
    const invitedCount = invitedUsers.length; // ← ここで人数カウント

    const baseUrl = process.env.BASE_URL || "https://star-io-hc9c.onrender.com";
    const inviteLink = `${baseUrl}/signup?ref=${me.referral_code}`;

    res.render("affiliate", {
      title: "アフィリエイト紹介",
      user: req.session.user,
      invitedCount,
      affiliateEarnings: me.affiliate_earnings || 0,
      inviteLink,
      invitedUsers      // ← ★ これをEJSに渡す
    });

  } catch (err) {
    console.error("❌ アフィリエイトページエラー:", err);
    res.status(500).send("アフィリエイト情報の取得に失敗しました。");
  }
});

module.exports = router;
