// Held-out precision sample (PD4): 40 findings not in the PD1 sample (30) nor the PD2 sample (60), drawn deterministically and stratified by project
// from a fresh scan with the CLI defaults (bundled SDP manifest, other-OS/vendored/test paths hidden). Needs corpus/src (corpus/run.sh).
// usage: node corpus/sample40.mjs            -> print the sample with context
//        node corpus/sample40.mjs --counts   -> print per-project totals (visible, hidden)
import { readFileSync } from 'node:fs';
import { scanDir } from '../src/scan.ts';
import { loadManifest } from '../src/sdp.ts';

const here = (p) => new URL(p, import.meta.url);
const old60 = readFileSync(here('./sample60.mjs'), 'utf8').match(/const OLD = new Set\(`([^`]+)`/)[1].split('|');
const pd2 = readFileSync(here('./precision-sample.txt'), 'utf8').split('\n').filter((l) => /^\d+\|/.test(l)).map((l) => { const c = l.split('|'); return `${c[1]} ${c[2]}`; });
const used = new Set([...old60, ...pd2]);
const plan = { libuv: 14, dropbear: 9, iperf: 7, libev: 7, cJSON: 3, lua: 0, kilo: 0 }; // lua (3) and kilo (1) have no findings left outside the earlier samples
const sdp = loadManifest(fileURLToPath(here('../data/sdp-8.0-manifest.json')));
import { fileURLToPath } from 'node:url';
const counts = process.argv.includes('--counts');
const out = [];
let tv = 0, th = 0;
for (const [name, n] of Object.entries(plan)) {
  const root = fileURLToPath(here(`./src/${name}`));
  const vis = scanDir(root, { sdp, hidePaths: true });
  const all = scanDir(root, { sdp, hidePaths: false });
  tv += vis.findings.length; th += all.findings.length - vis.findings.length;
  if (counts) { console.log(`${name}: ${all.findings.length} total, ${vis.findings.length} shown, ${all.findings.length - vis.findings.length} hidden ${JSON.stringify(vis.stats.hidden?.byReason ?? {})}`); continue; }
  const pool = vis.findings.filter((f) => !used.has(`${name} ${f.file}:${f.line}`));
  if (n === 0) continue;
  if (pool.length < n) throw new Error(`${name}: only ${pool.length} eligible`);
  const stride = pool.length / n;
  for (let k = 0; k < n; k++) {
    const f = pool[Math.floor(stride * k + stride / 2)];
    const ctx = f.context.filter((c) => Math.abs(c.n - f.line) <= 2).map((c) => `${c.n === f.line ? '>' : ' '}${c.n}: ${c.text.trim().slice(0, 130)}`);
    out.push({ n: out.length + 1, project: name, loc: `${f.file}:${f.line}`, rule: f.ruleId.replace('QNX-', ''), sev: f.severity, conf: f.confidence, guard: f.guard, guards: f.guards.join(' / '), ctx });
  }
}
if (counts) { console.log(`TOTAL ${tv + th} findings, ${tv} shown, ${th} hidden (${((th / (tv + th)) * 100).toFixed(1)}%)`); process.exit(0); }
if (out.length !== 40) throw new Error('expected 40, got ' + out.length);
for (const o of out) console.log(`#${o.n} ${o.project} ${o.loc} [${o.rule}] ${o.sev}/${o.conf} guard=${o.guard}${o.guards ? ' (' + o.guards + ')' : ''}\n${o.ctx.join('\n')}`);
