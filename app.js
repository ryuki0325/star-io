const express = require("express");
const expressLayouts = require("express-ejs-layouts"); // ★追加

const app = express();

app.set("view engine", "ejs");
app.use(expressLayouts); // ★追加
app.set("layout", "layouts/layout"); // ★共通レイアウトファイルを指定

