// Rebuilds the lists from CodeKairo's public export: README.md, most-asked.md,
// companies/*.md and assets/banner.svg.
//
//   node scripts/build.mjs                       read https://api.codekairo.com/api/seo/company-questions.json
//   SOURCE=./export.json node scripts/build.mjs  read a saved copy instead (for trying a change locally)
//
// No dependencies: Node 20+ (fetch). Run each night by .github/workflows/rebuild.yml,
// which commits only when something changed.
//
// It refuses to write anything when the export looks wrong (unreachable, an
// error page, far fewer companies than before), so a bad night never empties
// the lists — the workflow fails and yesterday's files stay.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = process.env.SOURCE ?? "https://api.codekairo.com/api/seo/company-questions.json";
const REPO = "ayaanp14/company-wise-coding-questions";
// One tag is enough for the site to file the visit (lib/traffic-source), and on a list of 1,000+ rows every character repeats.
const UTM = "utm_source=github";
const MIN_COMPANIES = 10;

async function load() {
  if (!/^https?:/.test(SOURCE)) return JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(SOURCE, { headers: { Accept: "application/json", "User-Agent": "company-wise-coding-questions (GitHub Actions)" }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, attempt * 10_000));
    }
  }
  throw new Error(`Could not read ${SOURCE}: ${last?.message ?? last}`);
}

const data = await load();
if (!Array.isArray(data?.companies) || data.companies.length < MIN_COMPANIES || typeof data.site !== "string") {
  throw new Error(`The export does not look right (${data?.companies?.length ?? "no"} companies); nothing was written.`);
}

/* ── helpers ─────────────────────────────────────────────────────── */

const site = data.site.replace(/\/+$/, "");
const topicLinks = data.topics ?? {};
const link = (p) => `${site}${p}${p.includes("?") ? "&" : "?"}${UTM}`;
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x) => x.toLocaleString("en-IN");
const refreshed = new Date(data.generatedAt ?? Date.now()).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
const LEVELS = ["Easy", "Medium", "Hard"];
const DOT = { Easy: "🟢", Medium: "🟡", Hard: "🔴" };
const PIE = { Easy: "#22C55E", Medium: "#EAB308", Hard: "#EF4444" };
/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
const anchor = (heading) => heading.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").replace(/ /g, "-");
/** A shields.io static badge (labels escape "-" as "--" and "_" as "__"). */
const badge = (label, message, color = "0079E8") =>
  `https://img.shields.io/badge/${[label, message].map((s) => encodeURIComponent(String(s).replace(/-/g, "--").replace(/_/g, "__"))).join("-")}-${color}?style=flat-square`;

/** "116 easy and 11 medium" — only the levels a company has. */
function split(counts) {
  const parts = [["easy", counts.easy], ["medium", counts.medium], ["hard", counts.hard]].filter(([, k]) => k > 0).map(([w, k]) => `${n(k)} ${w}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "none yet");
}

/** "🟢 116 · 🟡 11 · 🔴 0" */
const dots = (counts) => [["Easy", counts.easy], ["Medium", counts.medium], ["Hard", counts.hard]].map(([l, k]) => `${DOT[l]}&nbsp;${n(k)}`).join("&nbsp;· ");

/* ── how widely each question is asked ───────────────────────────── */

/** Question path → the companies that list it, and the question itself. */
const reach = new Map();
for (const c of data.companies) {
  for (const p of c.problems) {
    const r = reach.get(p.path) ?? { problem: p, companies: [] };
    r.companies.push(c);
    reach.set(p.path, r);
  }
}
const askedAt = (p) => reach.get(p.path)?.companies.length ?? 1;
const byReach = (a, b) => askedAt(b) - askedAt(a) || LEVELS.indexOf(a.difficulty) - LEVELS.indexOf(b.difficulty) || (a.number ?? Infinity) - (b.number ?? Infinity);
const unique = reach.size;
const mostAsked = [...reach.values()].filter((r) => r.companies.length > 1).sort((a, b) => byReach(a.problem, b.problem));

/* ── one company ─────────────────────────────────────────────────── */

function difficultyPie(c) {
  const slices = LEVELS.filter((l) => c.counts[l.toLowerCase()] > 0);
  const vars = Object.fromEntries(slices.map((l, i) => [`pie${i + 1}`, PIE[l]]));
  return [
    "```mermaid",
    `%%{init: {"theme": "base", "themeVariables": ${JSON.stringify({ ...vars, pieStrokeColor: "#FFFFFF", pieOuterStrokeWidth: "0px", pieSectionTextColor: "#111111" })}}}%%`,
    "pie showData",
    `    title ${c.name.replace(/[:"]/g, "")} questions by difficulty`,
    ...slices.map((l) => `    "${l}" : ${c.counts[l.toLowerCase()]}`),
    "```",
  ].join("\n");
}

function companyPage(c) {
  const practise = [
    `[All ${n(c.counts.total)} ${cell(c.name)} questions](${link(c.path)})`,
    ...c.tests.map((t) => `[${cell(t.name)} mock test](${link(t.path)})`),
    ...(c.simulation ? [`[${cell(c.name)} hiring process, round by round](${link(c.simulation.path)})`] : []),
    ...(c.experiences ? [`[${n(c.experiences.count)} ${cell(c.name)} interview experience${c.experiences.count === 1 ? "" : "s"}](${link(c.experiences.path)})`] : []),
  ];

  // The ten to open first: the ones the most other companies ask too, easier first on a tie.
  const start = [...c.problems].sort(byReach).slice(0, 10);
  // The topics this company's questions use most.
  const topicCount = new Map();
  for (const p of c.problems) for (const t of p.topics) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
  const topics = [...topicCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);

  const H_START = `Start with these ${start.length}`;
  const H_TOPICS = `Topics ${c.name} asks most`;
  const levelHeading = (level, count) => `${level} (${count})`;
  const present = LEVELS.map((level) => [level, c.problems.filter((p) => p.difficulty === level).length]).filter(([, k]) => k > 0);

  const lines = [
    `[← All companies](../README.md) · [Most asked across companies](../most-asked.md)`,
    "",
    `# ${c.name} Coding Questions`,
    "",
    `![Questions](${badge("questions", n(c.counts.total))}) ![Easy](${badge("easy", n(c.counts.easy), "22C55E")}) ![Medium](${badge("medium", n(c.counts.medium), "EAB308")}) ![Hard](${badge("hard", n(c.counts.hard), "EF4444")})`,
    "",
    `**${n(c.counts.total)} ${c.name} coding questions** — ${split(c.counts)}. Each one links to a free page where you can solve it in 13 languages, with hints and an editorial.`,
    "",
    c.blurb,
    "",
    `**Practise on CodeKairo:** ${practise.join(" · ")}`,
    "",
    "## Contents",
    "",
    `- [${H_START}](#${anchor(H_START)})`,
    `- [${H_TOPICS}](#${anchor(H_TOPICS)})`,
    ...present.map(([level, k]) => `- ${DOT[level]} [${level} (${n(k)})](#${anchor(levelHeading(level, k))})`),
    "",
    `## ${H_START}`,
    "",
    `The ${c.name} questions most other companies ask too — the patterns worth knowing first.`,
    "",
    ...start.map((p, i) => {
      const others = askedAt(p) - 1;
      return `${i + 1}. ${DOT[p.difficulty]} [${cell(p.title)}](${link(p.path)})${others > 0 ? ` — also asked at ${others} other compan${others === 1 ? "y" : "ies"}` : ""}`;
    }),
    "",
    `## ${H_TOPICS}`,
    "",
    topics.map(([t, k]) => (topicLinks[t] ? `[${cell(t)}](${link(topicLinks[t])}) (${k})` : `${cell(t)} (${k})`)).join(" · "),
    "",
    difficultyPie(c),
    "",
  ];
  for (const [level, k] of present) {
    const rows = c.problems.filter((p) => p.difficulty === level).sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.title.localeCompare(b.title));
    lines.push(`## ${levelHeading(level, k)}`, "", "| # | Question | Topics | Acceptance |", "|---:|---|---|---:|");
    for (const p of rows) {
      const tp = p.topics.slice(0, 3).map(cell).join(", ") || "—";
      lines.push(`| ${p.number ?? "—"} | ${DOT[level]} [${cell(p.title)}](${link(p.path)}) | ${tp} | ${p.acceptance == null ? "—" : `${p.acceptance}%`} |`);
    }
    lines.push("");
  }
  lines.push("---", "", `[← All companies](../README.md) · Rebuilt every night from [codekairo.com](${link(c.path)}). Last refreshed: ${refreshed}. ⭐ [Star the repo](https://github.com/${REPO}) if it helps.`, "");
  return lines.join("\n");
}

/* ── the most asked page ─────────────────────────────────────────── */

const companyRef = (c, prefix) => `[${cell(c.name)}](${prefix}${c.slug}.md)`;

function mostAskedTable(rows, prefix) {
  return [
    "| Rank | Question | Difficulty | Companies | Asked at |",
    "|---:|---|---|---:|---|",
    ...rows.map((r, i) => {
      const names = [...r.companies].sort((a, b) => b.counts.total - a.counts.total);
      const shown = names.slice(0, 4).map((c) => companyRef(c, prefix)).join(", ");
      const rest = names.length > 4 ? ` +${names.length - 4} more` : "";
      return `| ${i + 1} | [${cell(r.problem.title)}](${link(r.problem.path)}) | ${DOT[r.problem.difficulty]} ${r.problem.difficulty} | ${r.companies.length} | ${shown}${rest} |`;
    }),
  ].join("\n");
}

const MOST_ASKED_PAGE = 100;
const mostAskedPage = [
  `[← All companies](README.md)`,
  "",
  "# Most Asked Coding Interview Questions Across Companies",
  "",
  `The ${MOST_ASKED_PAGE} questions the most companies have asked, out of ${n(unique)} questions from ${data.companies.length} companies. A question many companies ask is a pattern worth knowing before any interview — start at the top.`,
  "",
  mostAskedTable(mostAsked.slice(0, MOST_ASKED_PAGE), "companies/"),
  "",
  "---",
  "",
  `Rebuilt every night from [codekairo.com](${link("/companies")}). Last refreshed: ${refreshed}. ⭐ [Star the repo](https://github.com/${REPO}) if it helps.`,
  "",
].join("\n");

/* ── the index ───────────────────────────────────────────────────── */

const byFamily = (family) => data.companies.filter((c) => c.family === family).sort((a, b) => b.counts.total - a.counts.total);
const service = byFamily("service");
const product = byFamily("product");
const other = data.companies.filter((c) => c.family !== "service" && c.family !== "product").sort((a, b) => a.name.localeCompare(b.name));
const headline = [...service.slice(0, 4), ...product.slice(0, 3)].map((c) => c.name);
const more = data.companies.length - headline.length;

function table(companies, withProcess) {
  const head = withProcess
    ? ["| Company | Questions | Difficulty | Mock test | Hiring process |", "|---|---:|---|---|---|"]
    : ["| Company | Questions | Difficulty |", "|---|---:|---|"];
  const rows = companies.map((c) => {
    const base = `| ${companyRef(c, "companies/")} | ${n(c.counts.total)} | ${dots(c.counts)} |`;
    if (!withProcess) return base;
    const test = c.tests[0] ? `[${cell(c.tests[0].name)}](${link(c.tests[0].path)})${c.tests.length > 1 ? ` +${c.tests.length - 1}` : ""}` : "—";
    const process = c.simulation ? `[${c.simulation.rounds} rounds](${link(c.simulation.path)})` : "—";
    return `${base} ${test} | ${process} |`;
  });
  return [...head, ...rows].join("\n");
}

const SECTIONS = [
  ...(service.length ? [["Service companies (campus placements)", table(service, true)]] : []),
  ...(product.length ? [["Product companies", table(product, true)]] : []),
  ...(other.length ? [["More companies", table(other, false)]] : []),
];
const H_MOST = "Most asked across companies";

const readme = [
  `<p align="center"><a href="${link("/companies")}"><img src="assets/banner.svg" alt="Company-wise Coding Questions: ${n(unique)} questions from ${data.companies.length} companies" width="100%"></a></p>`,
  "",
  `<p align="center">`,
  `  <img src="${badge("questions", n(unique))}" alt="${n(unique)} questions">`,
  `  <img src="${badge("companies", data.companies.length)}" alt="${data.companies.length} companies">`,
  `  <img src="${badge("practice", "free in 13 languages", "111111")}" alt="Free practice in 13 languages">`,
  `  <a href="https://github.com/${REPO}/actions/workflows/rebuild.yml"><img src="https://github.com/${REPO}/actions/workflows/rebuild.yml/badge.svg" alt="Rebuilt every night"></a>`,
  `  <a href="https://github.com/${REPO}/stargazers"><img src="https://img.shields.io/github/stars/${REPO}?style=flat-square&color=0079E8" alt="Stars"></a>`,
  `</p>`,
  "",
  "# Company-wise Coding Questions",
  "",
  `Coding questions asked by **${headline.join(", ")}** and ${more} more companies — **${n(unique)} questions** across **${data.companies.length} companies**, sorted by company and difficulty. Every question links to a free page on [CodeKairo](${link("/companies")}) where you can solve it in 13 languages, with hints and an editorial.`,
  "",
  "> ⭐ **Star the repo** so it is there when your drive comes — and so the next student searching finds it too. The lists are rebuilt every night.",
  "",
  "## Contents",
  "",
  ...SECTIONS.map(([h]) => `- [${h}](#${anchor(h)})`),
  `- [${H_MOST}](#${anchor(H_MOST)})`,
  "- [How to use these lists](#how-to-use-these-lists)",
  "- [Where the company tags come from](#where-the-company-tags-come-from)",
  "",
  ...SECTIONS.flatMap(([h, t]) => [`## ${h}`, "", t, ""]),
  `## ${H_MOST}`,
  "",
  `The questions the most companies ask — learn these and you have seen the patterns behind a large share of every list. [All ${MOST_ASKED_PAGE} →](most-asked.md)`,
  "",
  mostAskedTable(mostAsked.slice(0, 15), "companies/"),
  "",
  "## How to use these lists",
  "",
  "1. **Open your target company and do its \"Start with these 10\".** They are the questions most other companies ask too.",
  "2. **Then work down its Easy list.** It is the quickest way to see the patterns a company leans on before the harder questions.",
  "3. **Solve, don't read.** Each question's page runs your code against hidden tests in 13 languages; the hints come one at a time, and the editorial explains the approach with code in Python, Java, C++ and JavaScript.",
  `4. **Before a drive, sit the mock test.** Service companies' tests are built on each company's published pattern, and the [hiring process pages](${link("/simulations")}) walk through every round.`,
  `5. **Read what others were asked.** [Interview experiences](${link("/interview-experiences")}) are members' own accounts of real rounds.`,
  "",
  "## Where the company tags come from",
  "",
  "Each company's list is CodeKairo's own annotation of where a question tends to come up, built from public reports of past coding rounds and interviews. No company publishes or endorses these lists, and CodeKairo is not affiliated with any of them. They show what has been asked before, not what will be asked next — use them to practise the patterns, not as a leak.",
  "",
  "## Corrections",
  "",
  "Spotted a question under the wrong company, or a broken link? [Open an issue](../../issues) and it will be fixed at the source, so the next nightly rebuild carries it.",
  "",
  "---",
  "",
  `Rebuilt every night from [codekairo.com/companies](${link("/companies")}). Last refreshed: ${refreshed}.`,
  "",
].join("\n");

/* ── the banner ──────────────────────────────────────────────────── */

/**
 * The README's header, drawn with the numbers of the night. Its own dark
 * ground, so it reads the same in GitHub's light and dark themes; system
 * fonts, since an <img> SVG cannot load any.
 */
function banner() {
  const W = 1280;
  const H = 320;
  const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
  const pills = [...service.slice(0, 4), ...product.slice(0, 4)].map((c) => c.name);
  let x = 64;
  const chips = pills
    .map((name) => {
      const w = Math.round(name.length * 11.5 + 32);
      const chip = `<rect x="${x}" y="226" width="${w}" height="40" rx="20" fill="#FFFFFF" fill-opacity="0.12"/><text x="${x + w / 2}" y="252" font-family="${FONT}" font-size="19" font-weight="600" fill="#FFFFFF" text-anchor="middle">${xml(name)}</text>`;
      x += w + 12;
      return x <= W - 64 ? chip : "";
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Company-wise Coding Questions">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#003B75"/><stop offset="1" stop-color="#0068CC"/></linearGradient></defs>
<rect width="${W}" height="${H}" rx="24" fill="url(#g)"/>
<circle cx="${W - 120}" cy="60" r="180" fill="#3AA9FF" fill-opacity="0.12"/>
<circle cx="${W - 40}" cy="${H - 20}" r="120" fill="#7CC9FF" fill-opacity="0.10"/>
<text x="64" y="84" font-family="${FONT}" font-size="20" font-weight="600" letter-spacing="3" fill="#B9E3FF">COMPANY-WISE</text>
<text x="64" y="146" font-family="${FONT}" font-size="54" font-weight="800" fill="#FFFFFF">Coding Questions</text>
<text x="64" y="194" font-family="${FONT}" font-size="24" fill="#D9F0FF">${xml(`${n(unique)} questions · ${data.companies.length} companies · sorted by difficulty · rebuilt every night`)}</text>
${chips}
<text x="${W - 64}" y="84" font-family="${FONT}" font-size="20" font-weight="700" fill="#FFFFFF" text-anchor="end">codekairo.com</text>
</svg>
`;
}

/* ── write, and drop pages for companies no longer listed ───────────── */

const dir = path.join(ROOT, "companies");
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(path.join(ROOT, "assets"), { recursive: true });
const keep = new Set();
for (const c of data.companies) {
  const file = `${c.slug}.md`;
  keep.add(file);
  fs.writeFileSync(path.join(dir, file), companyPage(c));
}
for (const file of fs.readdirSync(dir)) if (file.endsWith(".md") && !keep.has(file)) fs.rmSync(path.join(dir, file));
fs.writeFileSync(path.join(ROOT, "README.md"), readme);
fs.writeFileSync(path.join(ROOT, "most-asked.md"), mostAskedPage);
fs.writeFileSync(path.join(ROOT, "assets", "banner.svg"), banner());
console.log(`${data.companies.length} companies, ${unique} questions, ${mostAsked.length} asked at 2+ companies, refreshed ${refreshed}.`);
