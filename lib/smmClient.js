const axios = require("axios");

const API_KEY = process.env.SMM_API_KEY;
const API_URL = process.env.SMM_API_URL || "https://smmflare.com/api/v2";

module.exports = {
  // サービス一覧
  async getServices() {
    const res = await axios.post(API_URL, {
      key: API_KEY,
      action: "services"
    });
    return res.data;
  },

  // 新規注文
  async createOrder(service, link, quantity) {
    const res = await axios.post(API_URL, {
      key: API_KEY,
      action: "add",
      service,
      link,
      quantity
    });
    return res.data; // { order: 12345 }
  },

  // 注文ステータス確認
  async getOrderStatus(orderId) {
    const res = await axios.post(API_URL, {
      key: API_KEY,
      action: "status",
      order: orderId
    });
    return res.data;
  }
};