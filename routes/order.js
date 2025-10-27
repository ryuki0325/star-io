const express = require('express');
const router = express.Router();
require('dotenv').config(); // .envを使うための設定

router.get('/', (req, res) => {
  // .envの「RECOMMENDED_SERVICES」を読み込む
  // 例: "7890,7892,7894" → ["7890", "7892", "7894"]
  const recommendedIds = process.env.RECOMMENDED_SERVICES
    ? process.env.RECOMMENDED_SERVICES.split(',').map(id => id.trim())
    : [];

  // =========================
// 🚀 非同期注文API
// =========================
router.post("/order", async (req, res) => {
  try {
    const userId = req.session.userId;
    const { serviceId, quantity } = req.body;
    const db = req.app.locals.db;

    // ユーザー残高取得
    const user = await db.query("SELECT balance FROM users WHERE id=$1", [userId]);
    const balance = user.rows[0].balance;

    // 商品情報取得
    const service = await db.query("SELECT price FROM services WHERE id=$1", [serviceId]);
    const totalPrice = service.rows[0].price * quantity;

    // 💰 残高チェック
    if (balance < totalPrice) {
      return res.json({
        error: "❌ 残高不足です。チャージしてください。",
      });
    }

    // 💸 残高OK → 注文処理
    await db.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [totalPrice, userId]);
    await db.query(
      "INSERT INTO orders (user_id, service_id, quantity, price, created_at) VALUES ($1,$2,$3,$4,NOW())",
      [userId, serviceId, quantity, totalPrice]
    );

    // 成功レスポンス
    res.json({ success: true });
  } catch (err) {
    console.error("❌ 注文エラー:", err);
    res.json({ error: "サーバーエラーが発生しました。" });
  }
});

  // 商品リスト（例）
  const services = [
    { id: 7889, name: 'TikTok Views + 10% HQ Likes', price: 24.00 },
    { id: 7890, name: 'TikTok Views + 20% HQ Likes', price: 42.00 },
    { id: 7891, name: 'TikTok Views + 30% HQ Likes', price: 54.00 },
    { id: 7892, name: 'TikTok Views + 40% HQ Likes', price: 72.00 },
    { id: 7893, name: 'TikTok Views + 50% HQ Likes', price: 84.00 },
  ];

  // もし「おすすめID」に含まれていれば、recommended = true にする
  const updatedServices = services.map(service => ({
    ...service,
    recommended: recommendedIds.includes(String(service.id)),
  }));

  // EJS（画面）に渡す
  res.render('order', { services: updatedServices });
});

module.exports = router;
