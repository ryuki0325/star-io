// utils/sendMail.js
const axios = require("axios");

async function sendMail(to, subject, html) {
  try {
    await axios.post("https://api.brevo.com/v3/smtp/email", {
      sender: { 
        name: "Star.io サポート", 
        email: "star.company527@gmail.com"  // ← Brevo上で認証済みドメイン or 送信者メール
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }, {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
    });

    console.log(`✅ Brevo経由でメール送信完了 → ${to}`);
  } catch (err) {
    console.error("❌ Brevoメール送信エラー:", err.response?.data || err.message);
    throw new Error("メール送信に失敗しました");
  }
}

module.exports = sendMail;
