// Draws assets/social-preview.png (1280×640): the card GitHub shows when the
// repository's link is shared. Upload it once under Settings → General →
// Social preview (GitHub has no API for it). Rounded figures, so it does not
// go stale as the lists grow; rerun after a big change.
//
//   node scripts/social-preview.mjs [path/to/fonts]
//
// Needs Playwright and a local Chrome — run it from a machine that has them
// (the CodeKairo frontend's node_modules does): it is not part of the nightly build.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONTS = path.resolve(process.argv[2] ?? path.join(ROOT, "..", "frontend", "public", "fonts"));
const require = createRequire(path.join(ROOT, "..", "frontend", "package.json"));
const { chromium } = require("playwright");

const font = (weight) => `@font-face{font-family:G;font-weight:${weight};src:url("data:font/woff2;base64,${fs.readFileSync(path.join(FONTS, `Gilroy-${weight}.woff2`)).toString("base64")}") format("woff2")}`;
const companies = ["TCS", "Infosys", "Wipro", "Accenture", "Cognizant", "Amazon", "Google", "Microsoft", "Adobe", "Flipkart"];
const html = `<!doctype html><html><head><style>
${[500, 600, 700].map(font).join("\n")}
*{box-sizing:border-box;margin:0}
body{width:1280px;height:640px;font-family:G,sans-serif;color:#fff;background:linear-gradient(135deg,#003B75,#0068CC);position:relative;overflow:hidden}
.glow{position:absolute;border-radius:50%;background:#3AA9FF;opacity:.14}
.wrap{position:absolute;inset:0;padding:72px 80px;display:flex;flex-direction:column}
.eyebrow{font-size:26px;font-weight:600;letter-spacing:.14em;color:#B9E3FF}
h1{margin-top:18px;font-size:88px;font-weight:700;line-height:1.02;letter-spacing:-.01em}
.sub{margin-top:26px;font-size:32px;font-weight:500;color:#D9F0FF}
.chips{margin-top:auto;display:flex;flex-wrap:wrap;gap:12px}
.chip{padding:10px 22px;border-radius:999px;background:rgba(255,255,255,.13);font-size:24px;font-weight:600}
.brand{position:absolute;top:72px;right:80px;font-size:28px;font-weight:700}
.diff{display:flex;gap:28px;margin-top:22px;font-size:26px;font-weight:600;color:#fff}
.diff span::before{content:"";display:inline-block;width:16px;height:16px;border-radius:50%;margin-right:10px;vertical-align:2px}
.e::before{background:#22C55E}.m::before{background:#EAB308}.h::before{background:#EF4444}
</style></head><body>
<div class="glow" style="width:520px;height:520px;right:-140px;top:-200px"></div>
<div class="glow" style="width:360px;height:360px;right:120px;bottom:-220px;opacity:.1"></div>
<div class="brand">codekairo.com</div>
<div class="wrap">
  <div class="eyebrow">COMPANY-WISE</div>
  <h1>Coding Questions</h1>
  <div class="sub">2,000+ questions from 60+ companies · free practice in 13 languages</div>
  <div class="diff"><span class="e">Easy</span><span class="m">Medium</span><span class="h">Hard</span></div>
  <div class="chips">${companies.map((c) => `<div class="chip">${c}</div>`).join("")}</div>
</div></body></html>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
fs.mkdirSync(path.join(ROOT, "assets"), { recursive: true });
await page.screenshot({ path: path.join(ROOT, "assets", "social-preview.png") });
await browser.close();
console.log("assets/social-preview.png written");
