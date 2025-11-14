// routes/affiliate.js

const express = require("express");
const router = express.Router();

// アフィリエイト紹介ページ
router.get("/affiliate", async (req, res) => {
  // ログインチェック
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  const db = req.app.locals.db;
  const userId = req.session.userId;

  try {
    // 自分の情報（紹介コード・累計紹介報酬）を取得
    const userRes = await db.query(
      "SELECT email, referral_code, affiliate_earnings FROM users WHERE id = $1",
      [userId]
    );
    const me = userRes.rows[0];

    // 紹介したユーザー数
    const invitedRes = await db.query(
      "SELECT COUNT(*) AS cnt FROM users WHERE referred_by = $1",
      [userId]
    );
    const invitedCount = invitedRes.rows[0].cnt;

    // 紹介リンク（本番URLは必要に応じて変更）
    const baseUrl = process.env.BASE_URL || "https://star-io-hc9c.onrender.com";
    const inviteLink = `${baseUrl}/signup?ref=${me.referral_code}`;

    res.render("affiliate", {
      title: "アフィリエイト紹介",
      user: req.session.user,                 // 既存のユーザー情報
      invitedCount,
      affiliateEarnings: me.affiliate_earnings || 0,
      inviteLink
    });

  } catch (err) {
    console.error("❌ アフィリエイトページエラー:", err);
    res.status(500).send("アフィリエイト情報の取得に失敗しました。");
  }
});

module.exports = router;
