// middleware/permission.js
module.exports = (permission) => {
  return (req, res, next) => {
    if (!req.user.permissions.includes(permission)) {
      return res.status(403).send("権限がありません");
    }
    next();
  };
};
