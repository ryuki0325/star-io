const axios = require("axios");

const API_KEY = process.env.SMM_API_KEY;
const API_URL = process.env.SMM_API_URL || "https://smmflare.com/api/v2";

module.exports = {
  // ================== サービス一覧 ==================
  async getServices() {
    try {
      const res = await axios.post(API_URL, {
        key: API_KEY,
        action: "services"
      });
      console.log("📦 SMMFlareサービス一覧取得成功");
      return res.data;
    } catch (err) {
      console.error("❌ SMMFlareサービス一覧エラー:", err.response?.data || err.message);
      throw err;
    }
  },

  // ================== 新規注文 ==================
  async createOrder(service, link, quantity) {
    try {
      const res = await axios.post(API_URL, {
        key: API_KEY,
        action: "add",
        service,
        link,
        quantity
      });
      console.log("📦 SMMFlare注文リクエスト:", { service, link, quantity });
      console.log("📦 SMMFlare注文レスポンス:", res.data);
      return res.data; // 例: { order: 12345 }
    } catch (err) {
      console.error("❌ SMMFlare注文APIエラー:", err.response?.data || err.message);
      throw err;
    }
  },

  // ================== 💰 残高取得 ==================
  async getBalance() {
    try {
      const res = await axios.post(API_URL, {
        key: API_KEY,
        action: "balance"
      });
      console.log("💰 SMMFlare残高取得成功:", res.data);
      return res.data.balance; // 残高だけ返す
    } catch (err) {
      console.error("❌ SMMFlare残高取得エラー:", err.response?.data || err.message);
      return null;
    }
  },



  // ================== 注文ステータス確認 ==================
  async getOrderStatus(orderId) {
    try {
      const res = await axios.post(API_URL, {
        key: API_KEY,
        action: "status",
        order: orderId
      });
      console.log("📦 SMMFlareステータスレスポンス:", res.data);
      return res.data;
    } catch (err) {
      console.error("❌ SMMFlareステータスAPIエラー:", err.response?.data || err.message);
      throw err;
    }
  }
};
