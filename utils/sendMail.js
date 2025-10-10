// utils/sendMail.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendMail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: `"Star.io 運営" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    });
    console.log("✅ メール送信完了:", to);
  } catch (err) {
    console.error("❌ メール送信エラー:", err);
    throw err;
  }
}

module.exports = sendMail;
