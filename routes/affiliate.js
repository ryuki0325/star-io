const express = require("express");
const router = express.Router();

router.get("/affiliate", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  const db = req.app.locals.db;
  const userId = req.session.userId;

  try {
    // ① 自分の情報を取得
    const userRes = await db.query(
      "SELECT email, referral_code, affiliate_earnings FROM users WHERE id = $1",
      [userId]
    );
    const me = userRes.rows[0];

    // ② 招待したユーザー一覧 + 報酬額
const invitedRes = await db.query(
  `SELECT 
      u.id,
      u.created_at,
      COALESCE(SUM(a.reward), 0) AS reward  -- ← 報酬合計
   FROM users u
   LEFT JOIN affiliate_logs a
     ON a.user_id = u.id  -- 紹介されたユーザー
   WHERE u.referred_by = $1
   GROUP BY u.id
   ORDER BY u.created_at DESC`,
  [userId]
);

const invitedUsers = invitedRes.rows;
const invitedCount = invitedUsers.length;

    // ③ 受け取った紹介報酬（affiliate_logs から）
    const rewardLogsRes = await db.query(
      `SELECT user_id, amount, reward, created_at
       FROM affiliate_logs
       WHERE referrer_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    const rewardLogs = rewardLogsRes.rows;

    // ④ 紹介リンク
    const baseUrl = process.env.BASE_URL || "https://star-io-hc9c.onrender.com";
    const inviteLink = `${baseUrl}/signup?ref=${me.referral_code}`;

    // ⑤ 表示
    res.render("affiliate", {
      title: "アフィリエイト紹介",
      user: req.session.user,
      invitedCount,
      affiliateEarnings: me.affiliate_earnings || 0,
      inviteLink,
      invitedUsers,
      rewardLogs          // ★ ← 追加済み！
    });

  } catch (err) {
    console.error("❌ アフィリエイトページエラー:", err);
    res.status(500).send("アフィリエイト情報の取得に失敗しました。");
  }
});

module.exports = router;
