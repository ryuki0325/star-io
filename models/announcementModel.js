// models/announcementModel.js
const pool = require("../db"); // あなたのDB接続ファイルに合わせて変更

module.exports = {
  // 全件取得（新しい順）
  async getAll() {
    const result = await pool.query(
      "SELECT * FROM announcements ORDER BY created_at DESC"
    );
    return result.rows;
  },

  // 1件追加
  async create(title, body) {
    await pool.query(
      "INSERT INTO announcements (title, body) VALUES ($1, $2)",
      [title, body]
    );
  },

  // 削除
  async delete(id) {
    await pool.query("DELETE FROM announcements WHERE id = $1", [id]);
  },
};
