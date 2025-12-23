// middleware/auth.js
module.exports = async (req, res, next) => {
  // DBからユーザーと権限を取得
  req.user = userFromDB;
  next();
};

app.use(require("./middleware/auth"));
