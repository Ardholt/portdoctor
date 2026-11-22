// Deterministic stratified sample of findings for hand review: node corpus/sample.mjs
import { readFileSync } from "node:fs";
const plan = { libuv: 8, dropbear: 6, iperf: 6, libev: 6, cJSON: 2, lua: 1, kilo: 1 };
const out = [];
for (const [name, n] of Object.entries(plan)) {
  const r = JSON.parse(readFileSync(new URL(`./reports/${name}.json`, import.meta.url)));
  const stride = Math.max(1, Math.floor(r.findings.length / n));
  for (let i = 0, k = 0; k < n && i < r.findings.length; i += stride, k++) {
    const f = r.findings[i];
    const hit = f.context.find((c) => c.n === f.line);
    out.push({ project: name, idx: i, file: f.file, line: f.line, rule: f.ruleId, sev: f.severity, guard: f.guard, text: hit ? hit.text.trim().slice(0, 110) : "(project)" });
  }
}
if (out.length !== 30) throw new Error("expected 30 samples, got " + out.length);
console.log(JSON.stringify(out, null, 1));
