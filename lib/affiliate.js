// lib/affiliate.js

// 紹介報酬を付与する関数
async function giveAffiliateReward(db, userId, amount) {
  try {
    // ① この userId の人が「誰に紹介されたか」を取得
    const userRes = await db.query(
      "SELECT referred_by FROM users WHERE id = $1",
      [userId]
    );

    if (userRes.rows.length === 0) {
      // そもそもユーザーが存在しない
      return;
    }

    const referrerId = userRes.rows[0].referred_by;

    // 紹介者がいない場合（refなしで登録した人）は何もしない
    if (!referrerId) {
      return;
    }

    // ② 報酬額を計算（ここでは入金額の5％）
    const reward = Math.floor(amount * 0.05); // 小数切り捨て

    if (reward <= 0) {
      // 1円未満なら何もしない
      return;
    }

    // ③ 紹介者の残高と、affiliate_earnings（累計紹介報酬）を加算
    await db.query(
      `UPDATE users
       SET balance = balance + $1,
           affiliate_earnings = affiliate_earnings + $1
       WHERE id = $2`,
      [reward, referrerId]
    );

    console.log(
      `🎁 アフィリエイト報酬: user ${referrerId} に ${reward} 円付与（紹介されたユーザー: ${userId}）`
    );
  } catch (err) {
    console.error("❌ アフィリエイト報酬付与エラー:", err);
  }
}

module.exports = {
  giveAffiliateReward,
};
