const express = require('express');
const router = express.Router();
require('dotenv').config(); // .envを使うための設定

router.get('/', (req, res) => {
  // .envの「RECOMMENDED_SERVICES」を読み込む
  // 例: "7890,7892,7894" → ["7890", "7892", "7894"]
  const recommendedIds = process.env.RECOMMENDED_SERVICES
    ? process.env.RECOMMENDED_SERVICES.split(',').map(id => id.trim())
    : [];

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
