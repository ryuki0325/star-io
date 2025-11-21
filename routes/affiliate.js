// routes/affiliate.js
const express = require("express");
const router = express.Router();

/**
 * 出金可能額を計算するヘルパー関数
 * 出金可能額 = 累計紹介報酬(affiliate_earnings)
 *              - すでに申請済み or 承認済みの出金額(pending + approved)
 */
async function getWithdrawableAmount(db, userId) {
  // 累計紹介報酬
  const userRes = await db.query(
    "SELECT affiliate_earnings FROM users WHERE id = $1",
    [userId]
  );
  const totalAffiliate = Number(userRes.rows[0]?.affiliate_earnings || 0);

  // すでに申請に使った金額
  const withdrawRes = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM withdraw_requests
     WHERE user_id = $1
       AND status IN ('pending', 'approved')`,
    [userId]
  );
  const usedAmount = Number(withdrawRes.rows[0]?.total || 0);

  return Math.max(totalAffiliate - usedAmount, 0);
}

// =======================
//  GET /affiliate
// =======================
router.get("/affiliate", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const db = req.app.locals.db;
  const userId = req.session.userId;

  // クエリパラメータからメッセージ
  const success = req.query.success || null;
  const error = req.query.error || null;

  try {
    // 自分の情報（紹介コード・累計紹介報酬・口座情報など）
    const userRes = await db.query(
      `SELECT email, referral_code, affiliate_earnings,
              paypay_id, bank_name, bank_branch, bank_account
       FROM users
       WHERE id = $1`,
      [userId]
    );
    const me = userRes.rows[0];

    // 招待したユーザー一覧 + そのユーザーから発生した報酬の合計
    const invitedRes = await db.query(
      `SELECT 
          u.id,
          u.created_at,
          COALESCE(SUM(a.reward), 0) AS reward
       FROM users u
       LEFT JOIN affiliate_logs a
         ON a.user_id = u.id
       WHERE u.referred_by = $1
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId]
    );
    const invitedUsers = invitedRes.rows;
    const invitedCount = invitedUsers.length;

    // 出金可能残高
    const withdrawableAmount = await getWithdrawableAmount(db, userId);

    // 紹介リンク
    const baseUrl =
      process.env.BASE_URL || "https://star-io-hc9c.onrender.com";
    const inviteLink = `${baseUrl}/signup?ref=${me.referral_code}`;

    res.render("affiliate", {
      title: "アフィリエイト紹介",
      user: req.session.user,
      // 画面で使う値
      inviteLink,
      invitedUsers,
      invitedCount,
      affiliateEarnings: me.affiliate_earnings || 0,
      withdrawableAmount,
      paypayId: me.paypay_id || "",
      bankName: me.bank_name || "",
      bankBranch: me.bank_branch || "",
      bankAccount: me.bank_account || "",
      success,
      error,
    });
  } catch (err) {
    console.error("❌ アフィリエイトページエラー:", err);
    res.status(500).send("アフィリエイト情報の取得に失敗しました。");
  }
});

// =======================
//  POST /affiliate/withdraw/balance
//  残高換金（即時反映）
// =======================
router.post("/affiliate/withdraw/balance", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const db = req.app.locals.db;
  const userId = req.session.userId;
  const amount = parseInt(req.body.amount, 10);

  try {
    const withdrawable = await getWithdrawableAmount(db, userId);

    if (!amount || amount <= 0) {
      return res.redirect(
        "/affiliate?error=" +
          encodeURIComponent("金額を正しく入力してください。")
      );
    }

    if (amount > withdrawable) {
      return res.redirect(
        "/affiliate?error=" +
          encodeURIComponent("出金可能残高を超えています。")
      );
    }

    // ユーザー残高に即時反映
    await db.query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [amount, userId]
    );

    // 出金申請テーブルにも「balance / approved」で記録
    await db.query(
      `INSERT INTO withdraw_requests
         (user_id, amount, method, status)
       VALUES ($1, $2, 'balance', 'approved')`,
      [userId, amount]
    );

    return res.redirect(
      "/affiliate?success=" +
        encodeURIComponent(`${amount}円を残高に換金しました。`)
    );
  } catch (err) {
    console.error("❌ 残高換金エラー:", err);
    return res.redirect(
      "/affiliate?error=" +
        encodeURIComponent("残高換金に失敗しました。")
    );
  }
});

// =======================
//  POST /affiliate/withdraw/paypay
//  PayPay換金（1000円〜・スタッフ承認）
// =======================
router.post("/affiliate/withdraw/paypay", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const db = req.app.locals.db;
  const userId = req.session.userId;

  const amount = parseInt(req.body.amount, 10);
  const paypayId = (req.body.paypay_id || "").trim();

  try {
    const withdrawable = await getWithdrawableAmount(db, userId);

    if (!amount || amount <= 0) {
      return res.redirect(
        "/affiliate?error=" +
          encodeURIComponent("金額を正しく入力してください。")
      );
    }

    if (amount < 1000) {
      return res.redirect(
        "/affiliate?error=" +
          encodeURIComponent("PayPay換金は1000円以上からです。")
      );
    }

    if (amount > withdrawable) {
      return res.redirect(
        "/affiliate?error=" +
          encodeURIComponent("出金可能残高を超えています。")
      );
    }

    if (!paypayId) {
      return res.redirect(
        "/affiliate?error=" +
          encodeURIComponent("PayPay ID を入力してください。")
      );
    }

    // ユーザー情報にも保存（次回以降自動入力用）
    await db.query("UPDATE users SET paypay_id = $1 WHERE id = $2", [
      paypayId,
      userId,
    ]);

    // 出金申請テーブルに pending で記録
    await db.query(
      `INSERT INTO withdraw_requests
         (user_id, amount, method, status, paypay_id)
       VALUES ($1, $2, 'paypay', 'pending', $3)`,
      [userId, amount, paypayId]
    );

    return res.redirect(
      "/affiliate?success=" +
        encodeURIComponent(
          `PayPay換金 ${amount}円 の申請を受け付けました。`
        )
    );
  } catch (err) {
    console.error("❌ PayPay換金エラー:", err);
    return res.redirect(
      "/affiliate?error=" +
        encodeURIComponent("PayPay換金の申請に失敗しました。")
    );
  }
});

// =======================
//  POST /affiliate/withdraw/bank
//  銀行振込換金（1000円〜・スタッフ承認）
// =======================
router.post("/affiliate/withdraw/bank", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const db = req.app.locals.db;
  const userId = req.session.userId;

  const amount = parseInt(req.body.amount, 10);
  const bankName = (req.body.bank_name || "").trim();
  const bankBranch = (req.body.bank_branch || "").trim();
  const bankAccount = (req.body.bank_account || "").trim();

  try {
    const withdrawable = await getWithdrawableAmount(db, userId);

    if (!amount || amount <= 0) {
      return res.redirect(
        "/affiliate?error=" +
          encodeURIComponent("金額を正しく入力してください。")
      );
    }

    if (amount < 1000) {
      return res.redirect(
        "/affiliate?error=" +
          encodeURIComponent("銀行振込は1000円以上からです。")
      );
    }

    if (amount > withdrawable) {
      return res.redirect(
        "/affiliate?error=" +
          encodeURIComponent("出金可能残高を超えています。")
      );
    }

    if (!bankName || !bankBranch || !bankAccount) {
      return res.redirect(
        "/affiliate?error=" +
          encodeURIComponent(
            "銀行名・支店名・口座番号をすべて入力してください。"
          )
      );
    }

    // ユーザー情報にも保存
    await db.query(
      `UPDATE users
       SET bank_name = $1,
           bank_branch = $2,
           bank_account = $3
       WHERE id = $4`,
      [bankName, bankBranch, bankAccount, userId]
    );

    // 出金申請テーブルに pending で記録
    await db.query(
      `INSERT INTO withdraw_requests
         (user_id, amount, method, status, bank_name, bank_branch, bank_account)
       VALUES ($1, $2, 'bank', 'pending', $3, $4, $5)`,
      [userId, amount, bankName, bankBranch, bankAccount]
    );

    return res.redirect(
      "/affiliate?success=" +
        encodeURIComponent(`銀行振込 ${amount}円 の申請を受け付けました。`)
    );
  } catch (err) {
    console.error("❌ 銀行振込換金エラー:", err);
    return res.redirect(
      "/affiliate?error=" +
        encodeURIComponent("銀行振込の申請に失敗しました。")
    );
  }
});

module.exports = router;
