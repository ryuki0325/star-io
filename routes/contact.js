const express = require("express");
const router = express.Router();
const sendMail = require("../utils/sendMail");

router.get("/", (req, res) => {
  res.render("contact", { title: "お問い合わせ", success: null, error: null });
});

router.post("/", async (req, res) => {
  const { category, subcategory, orderId, email, message } = req.body;

  try {
    const subject = `📩 お問い合わせ - ${category} / ${subcategory}`;
    const html = `
      <h2>📨 新しいお問い合わせが届きました</h2>
      <p><b>カテゴリ:</b> ${category}</p>
      <p><b>サブカテゴリ:</b> ${subcategory}</p>
      <p><b>注文ID:</b> ${orderId || "（未入力）"}</p>
      <p><b>送信者メール:</b> ${email}</p>
      <hr>
      <p><b>内容:</b></p>
      <pre style="font-family:inherit; white-space:pre-wrap;">${message}</pre>
    `;

    // 📧 Gmail宛に送信
    await sendMail("star.company527@gmail.com", subject, html);

    res.render("contact", {
      title: "お問い合わせ",
      success: "お問い合わせを送信しました！",
      error: null
    });
  } catch (err) {
    console.error("❌ メール送信エラー:", err);
    res.render("contact", {
      title: "お問い合わせ",
      success: null,
      error: "送信に失敗しました。時間をおいて再度お試しください。"
    });
  }
});

module.exports = router;
