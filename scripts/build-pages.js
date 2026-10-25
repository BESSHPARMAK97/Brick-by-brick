// Собирает сайт для GitHub Pages: портал проекта (с дорожной картой внутри) в полном HTML-документе плюс папка docs.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "_site");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const head = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>";
const portal = fs.readFileSync(path.join(root, "prototype/index.html"), "utf8");
fs.writeFileSync(path.join(out, "index.html"), head + portal + "</body></html>");
fs.cpSync(path.join(root, "docs"), path.join(out, "docs"), { recursive: true });
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log("built _site");
