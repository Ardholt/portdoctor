// Computes corpus/PRECISION.md tables from corpus/precision-sample.txt: node corpus/precision.mjs
import { readFileSync } from "node:fs";
const rows = readFileSync(new URL("./precision-sample.txt", import.meta.url), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => { const [n, project, loc, rule, verdict, note] = l.split("|"); return { n: +n, project, loc, rule, verdict, note }; });
if (rows.length !== 60) throw new Error("expected 60 rows, got " + rows.length);
const V = ["TP", "TPf", "TPg", "INFO", "OTHER", "FP"];
for (const r of rows) if (!V.includes(r.verdict)) throw new Error("bad verdict " + r.n);
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "-");
const tally = (rs) => Object.fromEntries(V.map((v) => [v, rs.filter((r) => r.verdict === v).length]));
const line = (name, rs) => { const t = tally(rs); const ok = t.TP + t.TPf + t.TPg + t.INFO; return `| ${name} | ${rs.length} | ${V.map((v) => t[v]).join(" | ")} | ${ok}/${rs.length} (${pct(ok, rs.length)}) | ${t.FP}/${rs.length} (${pct(t.FP, rs.length)}) |`; };
const head = `| ${"Group"} | n | ${V.join(" | ")} | rule did what it says | rule bug |\n|---|---|${V.map(() => "---").join("|")}|---|---|`;
const rules = [...new Set(rows.map((r) => r.rule))].sort();
const projects = [...new Set(rows.map((r) => r.project))];
console.log(head + "\n" + line("**all 60**", rows));
console.log("\nBY RULE\n" + head + "\n" + rules.map((x) => line(x, rows.filter((r) => r.rule === x))).join("\n"));
console.log("\nBY PROJECT\n" + head + "\n" + projects.map((x) => line(x, rows.filter((r) => r.project === x))).join("\n"));
