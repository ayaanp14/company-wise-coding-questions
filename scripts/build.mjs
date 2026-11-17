// Rebuilds README.md and companies/*.md from CodeKairo's public export.
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

const site = data.site.replace(/\/+$/, "");
const link = (p) => `${site}${p}${p.includes("?") ? "&" : "?"}${UTM}`;
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const n = (x) => x.toLocaleString("en-IN");
const refreshed = new Date(data.generatedAt ?? Date.now()).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
const LEVELS = ["Easy", "Medium", "Hard"];

/* ── one company ─────────────────────────────────────────────────── */

/** "116 easy and 11 medium" — only the levels a company has. */
function split(counts) {
  const parts = [["easy", counts.easy], ["medium", counts.medium], ["hard", counts.hard]].filter(([, k]) => k > 0).map(([w, k]) => `${n(k)} ${w}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "none yet");
}

function companyPage(c) {
  const practise = [
    `[All ${n(c.counts.total)} ${cell(c.name)} questions](${link(c.path)})`,
    ...c.tests.map((t) => `[${cell(t.name)} mock test](${link(t.path)})`),
    ...(c.simulation ? [`[${cell(c.name)} hiring process, round by round](${link(c.simulation.path)})`] : []),
    ...(c.experiences ? [`[${n(c.experiences.count)} ${cell(c.name)} interview experience${c.experiences.count === 1 ? "" : "s"}](${link(c.experiences.path)})`] : []),
  ];
  const lines = [
    `# ${c.name} Coding Questions`,
    "",
    `**${n(c.counts.total)} ${c.name} coding questions** — ${split(c.counts)}. Each one links to a free page where you can solve it in 13 languages, with hints and an editorial.`,
    "",
    c.blurb,
    "",
    `**Practise on CodeKairo:** ${practise.join(" · ")}`,
    "",
    "## Contents",
    "",
    ...LEVELS.map((level) => {
      const count = c.problems.filter((p) => p.difficulty === level).length;
      return count ? `- [${level} (${n(count)})](#${level.toLowerCase()}-${count})` : null;
    }).filter(Boolean),
    "",
  ];
  for (const level of LEVELS) {
    const rows = c.problems
      .filter((p) => p.difficulty === level)
      .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.title.localeCompare(b.title));
    if (!rows.length) continue;
    lines.push(`## ${level} (${rows.length})`, "", "| # | Question | Topics | Acceptance |", "|---:|---|---|---:|");
    for (const p of rows) {
      const topics = p.topics.slice(0, 3).map(cell).join(", ") || "—";
      lines.push(`| ${p.number ?? "—"} | [${cell(p.title)}](${link(p.path)}) | ${topics} | ${p.acceptance == null ? "—" : `${p.acceptance}%`} |`);
    }
    lines.push("");
  }
  lines.push("---", "", `[← All companies](../README.md) · Rebuilt every night from [codekairo.com](${link(c.path)}). Last refreshed: ${refreshed}.`, "");
  return lines.join("\n");
}

/* ── the index ───────────────────────────────────────────────────── */

const unique = new Set(data.companies.flatMap((c) => c.problems.map((p) => p.path))).size;
const byFamily = (family) => data.companies.filter((c) => c.family === family).sort((a, b) => b.counts.total - a.counts.total);
const service = byFamily("service");
const product = byFamily("product");
const other = data.companies.filter((c) => c.family !== "service" && c.family !== "product").sort((a, b) => a.name.localeCompare(b.name));
const headline = [...service.slice(0, 4), ...product.slice(0, 3)].map((c) => c.name);
const more = data.companies.length - headline.length;

function table(companies, withProcess) {
  const head = withProcess
    ? ["| Company | Questions | Easy · Medium · Hard | Mock test | Hiring process |", "|---|---:|---|---|---|"]
    : ["| Company | Questions | Easy · Medium · Hard |", "|---|---:|---|"];
  const rows = companies.map((c) => {
    const base = `| [${cell(c.name)}](companies/${c.slug}.md) | ${n(c.counts.total)} | ${n(c.counts.easy)} · ${n(c.counts.medium)} · ${n(c.counts.hard)} |`;
    if (!withProcess) return base;
    const test = c.tests[0] ? `[${cell(c.tests[0].name)}](${link(c.tests[0].path)})${c.tests.length > 1 ? ` +${c.tests.length - 1}` : ""}` : "—";
    const process = c.simulation ? `[${c.simulation.rounds} rounds](${link(c.simulation.path)})` : "—";
    return `${base} ${test} | ${process} |`;
  });
  return [...head, ...rows].join("\n");
}

const readme = [
  "# Company-wise Coding Questions",
  "",
  `Coding questions asked by **${headline.join(", ")}** and ${more} more companies — **${n(unique)} questions** across **${data.companies.length} companies**, sorted by company and difficulty. Every question links to a free page on [CodeKairo](${link("/companies")}) where you can solve it in 13 languages, with hints and an editorial.`,
  "",
  "⭐ Star the repo to keep it handy — the lists are rebuilt every night.",
  "",
  ...(service.length ? ["## Service companies (campus placements)", "", table(service, true), ""] : []),
  ...(product.length ? ["## Product companies", "", table(product, true), ""] : []),
  ...(other.length ? ["## More companies", "", table(other, false), ""] : []),
  "## How to use these lists",
  "",
  "- **Start with your target company's Easy section.** It is the quickest way to see the patterns a company leans on before the harder questions.",
  "- **Solve, don't read.** Each question's page runs your code against hidden tests in 13 languages; the hints come one at a time, and the editorial explains the approach with code in Python, Java, C++ and JavaScript.",
  `- **Before a drive, sit the mock test.** Service companies' tests are built on each company's published pattern, and the [hiring process pages](${link("/simulations")}) walk through every round.`,
  `- **Read what others were asked.** [Interview experiences](${link("/interview-experiences")}) are members' own accounts of real rounds.`,
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

/* ── write, and drop pages for companies no longer listed ───────────── */

const dir = path.join(ROOT, "companies");
fs.mkdirSync(dir, { recursive: true });
const keep = new Set();
for (const c of data.companies) {
  const file = `${c.slug}.md`;
  keep.add(file);
  fs.writeFileSync(path.join(dir, file), companyPage(c));
}
for (const file of fs.readdirSync(dir)) if (file.endsWith(".md") && !keep.has(file)) fs.rmSync(path.join(dir, file));
fs.writeFileSync(path.join(ROOT, "README.md"), readme);
console.log(`${data.companies.length} companies, ${unique} questions, refreshed ${refreshed}.`);
