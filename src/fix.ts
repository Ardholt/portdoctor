import { cpSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanDir } from './scan.ts';
import { groupFindings, startHere } from './group.ts';
import { buildRequest, readWindow, evaluateResponse, parseProviderOutput, patchPaths } from './propose.ts';
import type { Finding, ScanResult } from './types.ts';

export type CheckStatus = 'pass' | 'no-worse' | 'fail' | 'skipped';

export interface StepResult {
  ruleId: string;
  title: string;
  file: string;
  line: number;
  status: 'applied' | 'rejected' | 'check-failed' | 'provider-failed' | 'already-resolved';
  detail: string;
  explanation?: string;
  confidence?: string;
  needsHuman?: boolean;
  assumptions?: string[];
  diff?: string;
  applyCheck?: string;
  check?: { status: CheckStatus; command: string; baselineErrors: number; errors: number; output: string };
  findingsBefore: number;
  findingsAfter: number;
}

export interface FixResult {
  root: string;
  workDir: string;
  before: ScanResult['stats'];
  after: ScanResult['stats'];
  steps: StepResult[];
  checkLabel: string;
}

export const CHECK_LABEL =
  'Compile check here is host gcc syntax-only (-fsyntax-only -D__QNXNTO__), NOT a QNX build: it cannot know whether a QNX header or function exists. ' +
  'A qcc check will replace it; --check is pluggable.';

const C_EXT = new Set(['.c', '.h']);
const CXX_EXT = new Set(['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx']);

function sub(cmd: string, vars: Record<string, string>): string {
  return cmd.replace(/\{(file|root|dir)\}/g, (_, k) => `'${vars[k].replace(/'/g, `'\\''`)}'`);
}

export function defaultCheck(file: string): string | null {
  const e = extname(file).toLowerCase();
  if (C_EXT.has(e)) return `gcc -fsyntax-only -x c -D__QNXNTO__=1 -D__QNX__=1 -I{dir} -I{root} {file}`;
  if (CXX_EXT.has(e)) return `g++ -fsyntax-only -x c++ -D__QNXNTO__=1 -D__QNX__=1 -I{dir} -I{root} {file}`;
  return null;
}

function countErrors(out: string): number {
  return out.split('\n').filter((l) => /\berror\b/i.test(l) && !/^\s*(?:note|warning)/i.test(l)).length;
}

export function runCheck(cmdTemplate: string | null, root: string, file: string): { status: CheckStatus | 'n/a'; command: string; errors: number; output: string; ok: boolean } {
  const rel = file;
  const abs = join(root, rel);
  const tpl = cmdTemplate ?? defaultCheck(rel);
  if (!tpl) return { status: 'skipped', command: '(none for this file type)', errors: 0, output: 'not a C/C++ file; no default check', ok: true };
  const cmd = sub(tpl, { file: abs, root, dir: dirname(abs) });
  const r = spawnSync(cmd, { shell: true, cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 << 20, env: { ...process.env, PD_FILE: abs, PD_ROOT: root } });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.error || (r.status === 127 && /not found/.test(output))) {
    return { status: 'skipped', command: cmd, errors: 0, output: output || String(r.error), ok: true };
  }
  return { status: r.status === 0 ? 'pass' : 'fail', command: cmd, errors: countErrors(output), output: output.slice(0, 4000), ok: r.status === 0 };
}

function applyPatch(diff: string, root: string): { ok: boolean; detail: string } {
  const r = spawnSync('git', ['apply', '-p1', '-'], { cwd: root, input: diff.endsWith('\n') ? diff : diff + '\n', encoding: 'utf8' });
  return { ok: r.status === 0, detail: (r.stderr || r.stdout || '').trim() };
}

export interface FixOptions {
  provider: string;
  check?: string;
  count?: number;
  rules?: string[];
  ignore?: string[];
  keep?: string;
}

export function runFix(dir: string, o: FixOptions): FixResult {
  const root = resolve(dir);
  const work = o.keep ? resolve(o.keep) : mkdtempSync(join(tmpdir(), 'portdoctor-fix-'));
  cpSync(root, work, { recursive: true, filter: (s) => !/(^|\/)(\.git|node_modules)(\/|$)/.test(s.slice(root.length)) });
  const scanOpts = { ignore: o.ignore };
  const original = scanDir(work, scanOpts);
  let groups = startHere(groupFindings(original), 1000);
  if (o.rules?.length) groups = groups.filter((g) => o.rules!.includes(g.ruleId));
  const targets = groups.slice(0, o.count ?? 3).map((g) => {
    const sites = g.sites.map((i) => original.findings[i]);
    return sites.find((f) => f.guard !== 'linux-only') ?? sites[0];
  });
  const steps: StepResult[] = [];
  let current = original;
  for (const t of targets) {
    const f: Finding | undefined = current.findings.filter((x) => x.ruleId === t.ruleId && x.file === t.file).sort((a, b) => Math.abs(a.line - t.line) - Math.abs(b.line - t.line))[0];
    const base: Pick<StepResult, 'ruleId' | 'title' | 'file' | 'line' | 'findingsBefore'> = { ruleId: t.ruleId, title: t.title, file: t.file, line: t.line, findingsBefore: current.stats.findings };
    if (!f) {
      steps.push({ ...base, status: 'already-resolved', detail: 'no longer reported after earlier patches', findingsAfter: current.stats.findings });
      continue;
    }
    const req = buildRequest(f, readWindow(work, f));
    const pr = spawnSync(o.provider, { shell: true, input: JSON.stringify(req), encoding: 'utf8', timeout: 300_000, maxBuffer: 16 << 20, env: { ...process.env, PD_ROOT: work } });
    if (pr.error || pr.status !== 0) {
      steps.push({ ...base, status: 'provider-failed', detail: `provider ${pr.error?.message ?? 'exit ' + pr.status}: ${(pr.stderr ?? '').trim().slice(0, 600)}`, findingsAfter: current.stats.findings });
      continue;
    }
    let resp;
    try {
      resp = parseProviderOutput(pr.stdout);
    } catch (e) {
      steps.push({ ...base, status: 'rejected', detail: (e as Error).message, findingsAfter: current.stats.findings });
      continue;
    }
    const out = evaluateResponse(resp, work);
    const r = resp as { unifiedDiff?: string; explanation?: string; confidence?: string; needsHuman?: boolean; assumptions?: string[] };
    const meta = { explanation: r.explanation, confidence: r.confidence, needsHuman: r.needsHuman, assumptions: r.assumptions, diff: r.unifiedDiff };
    if (!out.ok) {
      steps.push({ ...base, ...meta, status: 'rejected', detail: `${out.stage}: ${out.errors.join('; ')}`, applyCheck: out.applyCheck, findingsAfter: current.stats.findings });
      continue;
    }
    const touched = [...new Set(patchPaths(r.unifiedDiff!))];
    const backups = new Map(touched.filter((p) => existsSync(join(work, p))).map((p) => [p, readFileSync(join(work, p))]));
    const checkFiles = touched.filter((p) => cOrCxx(p) || o.check);
    const baseline = checkFiles.map((p) => runCheck(o.check ?? null, work, p));
    const ap = applyPatch(r.unifiedDiff!, work);
    if (!ap.ok) {
      steps.push({ ...base, ...meta, status: 'rejected', detail: 'apply: ' + ap.detail, applyCheck: out.applyCheck, findingsAfter: current.stats.findings });
      continue;
    }
    const after = checkFiles.map((p) => runCheck(o.check ?? null, work, p));
    const bErr = baseline.reduce((a, c) => a + c.errors, 0);
    const aErr = after.reduce((a, c) => a + c.errors, 0);
    const failing = after.filter((c) => c.status === 'fail');
    let status: CheckStatus = 'pass';
    if (after.length === 0 || after.every((c) => c.status === 'skipped')) status = 'skipped';
    else if (failing.length) status = baseline.some((c) => c.status === 'fail') && bErr > 0 && aErr <= bErr ? 'no-worse' : 'fail';
    const checkInfo = { status, command: after.map((c) => c.command).join(' ; ') || '(no C/C++ file touched)', baselineErrors: bErr, errors: aErr, output: after.map((c) => c.output).filter(Boolean).join('\n').slice(0, 4000) };
    if (status === 'fail') {
      for (const p of touched) {
        const b = backups.get(p);
        if (b) writeFileSync(join(work, p), b);
        else spawnSync('rm', ['-f', join(work, p)]);
      }
      steps.push({ ...base, ...meta, status: 'check-failed', detail: 'check failed; patch reverted', applyCheck: out.applyCheck, check: checkInfo, findingsAfter: current.stats.findings });
      continue;
    }
    current = scanDir(work, scanOpts);
    steps.push({ ...base, ...meta, status: 'applied', detail: 'applied', applyCheck: out.applyCheck, check: checkInfo, findingsAfter: current.stats.findings });
  }
  return { root, workDir: work, before: original.stats, after: scanDir(work, scanOpts).stats, steps, checkLabel: CHECK_LABEL };
}

function cOrCxx(p: string): boolean {
  const e = extname(p).toLowerCase();
  return C_EXT.has(e) || CXX_EXT.has(e);
}

const esc = (s: unknown): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fixText(r: FixResult): string {
  const L = [`PortDoctor fix: ${r.root}`, `patched copy: ${r.workDir}`, ''];
  r.steps.forEach((s, i) => {
    L.push(`${i + 1}. ${s.ruleId} ${s.file}:${s.line}  ${s.status.toUpperCase()}${s.check ? `  check=${s.check.status}` : ''}  findings ${s.findingsBefore} -> ${s.findingsAfter}`);
    if (s.status !== 'applied') L.push(`   ${s.detail}`);
  });
  const sev = (x: FixResult['before']) => `blocker ${x.bySeverity.blocker}, major ${x.bySeverity.major}, minor ${x.bySeverity.minor}, info ${x.bySeverity.info}`;
  L.push('', `before: ${r.before.findings} findings (${sev(r.before)})`, `after:  ${r.after.findings} findings (${sev(r.after)})`, '', r.checkLabel);
  return L.join('\n') + '\n';
}

export function fixHtml(r: FixResult): string {
  const rows = r.steps
    .map(
      (s, i) => `<section class="step st-${s.status}"><h3>${i + 1}. ${esc(s.title)} <code>${esc(s.file)}:${s.line}</code> <span class="pill">${esc(s.status)}</span></h3>
<p class="note">${esc(s.ruleId)} &middot; findings ${s.findingsBefore} &rarr; ${s.findingsAfter}${s.confidence ? ` &middot; model confidence: ${esc(s.confidence)}` : ''}${s.needsHuman ? ' &middot; needs human review' : ''}</p>
${s.explanation ? `<p>${esc(s.explanation)}</p>` : ''}${s.status !== 'applied' ? `<p class="bad">${esc(s.detail)}</p>` : ''}
${s.diff ? `<pre class="diff">${esc(s.diff)
        .split('\n')
        .map((l) => `<span class="${l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : ''}">${l}</span>`)
        .join('\n')}</pre>` : ''}
${s.applyCheck ? `<p class="note">git apply --check: ${esc(s.applyCheck)}</p>` : ''}
${s.check ? `<p class="note">Check <strong>${esc(s.check.status)}</strong> (errors before ${s.check.baselineErrors}, after ${s.check.errors}): <code>${esc(s.check.command)}</code></p>${s.check.output ? `<pre class="out">${esc(s.check.output)}</pre>` : ''}` : ''}
${s.assumptions?.length ? `<p class="note">Assumptions not verified: ${s.assumptions.map(esc).join('; ')}</p>` : ''}</section>`,
    )
    .join('\n');
  const sev = (x: FixResult['before']) => `${x.bySeverity.blocker} blocker &middot; ${x.bySeverity.major} major &middot; ${x.bySeverity.minor} minor &middot; ${x.bySeverity.info} info`;
  const applied = r.steps.filter((s) => s.status === 'applied').length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PortDoctor fix report</title><meta name="color-scheme" content="light dark">
<style>
:root{--bg:#f4f6f9;--s:#fff;--t:#14181f;--m:#566071;--b:#d5dae3;--ok:#0b6b2f;--bad:#a8200f;--acc:#0a58c9}
@media (prefers-color-scheme:dark){:root{--bg:#0e1218;--s:#161b23;--t:#e7eaf0;--m:#9aa4b5;--b:#2b3342;--ok:#7ddc9b;--bad:#ff9a8f;--acc:#79afff}}
body{margin:0;background:var(--bg);color:var(--t);font:15px/1.5 system-ui,sans-serif}main{max-width:1000px;margin:0 auto;padding:1.5rem 1rem 4rem}
.banner{border-left:4px solid #9a3f00;background:color-mix(in srgb,#ff9a3d 18%,var(--s));padding:.6rem 1rem;border-radius:6px}
.ba{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.card{background:var(--s);border:1px solid var(--b);border-radius:10px;padding:.8rem 1rem}.card .n{font-size:2rem;font-weight:700}
section.step{background:var(--s);border:1px solid var(--b);border-radius:10px;padding:.2rem 1rem .8rem;margin:.8rem 0}
.pill{font-size:.75rem;border:1px solid var(--b);border-radius:999px;padding:0 .5rem}.st-applied .pill{color:var(--ok);border-color:var(--ok)}.st-applied h3::before{content:"\\2713 ";color:var(--ok)}
.bad{color:var(--bad)}.note{color:var(--m);font-size:.88rem}pre{overflow:auto;background:color-mix(in srgb,var(--t) 5%,var(--s));border:1px solid var(--b);border-radius:8px;padding:.5rem .8rem;font:.82rem/1.45 ui-monospace,Menlo,monospace}
.add{color:var(--ok)}.del{color:var(--bad)}code{font-family:ui-monospace,Menlo,monospace;font-size:.88em}
</style></head><body><main>
<h1>PortDoctor fix report</h1>
<p class="note">${esc(basename(r.root))} &middot; patches were applied to a copy, the original tree is untouched.</p>
<p class="banner"><strong>Not a QNX build.</strong> ${esc(r.checkLabel)} Proposed patches are from a model or provider you chose; PortDoctor calls none itself.</p>
<h2>Before and after</h2>
<div class="ba"><div class="card"><div class="n">${r.before.findings}</div>findings before<br><span class="note">${sev(r.before)}</span></div>
<div class="card"><div class="n">${r.after.findings}</div>findings after (re-scan of the patched copy)<br><span class="note">${sev(r.after)}</span></div></div>
<p>${applied} of ${r.steps.length} chosen findings patched and passing the check.</p>
<h2>Steps</h2>
${rows}
</main></body></html>
`;
}

export async function runFixCli(argv: string[]): Promise<number> {
  const args = argv.slice();
  const take = (n: string) => {
    const i = args.indexOf(n);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (v === undefined) throw new Error(`${n} needs a value`);
    args.splice(i, 2);
    return v;
  };
  const provider = take('--provider');
  const check = take('--check');
  const count = Number(take('--count') ?? 3);
  const out = take('-o') ?? 'fix-report.html';
  const keep = take('--keep');
  const rules: string[] = [];
  for (let v = take('--rule'); v !== undefined; v = take('--rule')) rules.push(v);
  const ignore: string[] = [];
  for (let v = take('--ignore'); v !== undefined; v = take('--ignore')) ignore.push(v);
  const json = args.includes('--json');
  if (json) args.splice(args.indexOf('--json'), 1);
  const dir = args.shift();
  if (!dir || !provider || args.length) throw new Error('usage: portdoctor fix <dir> --provider "<cmd>" [--check "<cmd>"] [--count N] [--rule ID] [--keep <dir>] [-o fix-report.html]');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`not a directory: ${dir}`);
  if (!Number.isInteger(count) || count < 1) throw new Error('--count must be a positive integer');
  const r = runFix(dir, { provider, check, count, rules, ignore, keep });
  writeFileSync(out, fixHtml(r));
  process.stdout.write(json ? JSON.stringify(r, null, 2) + '\n' : fixText(r) + `report: ${out}\n`);
  if (r.steps.length && r.steps.every((s) => s.status === 'provider-failed')) return 3;
  return r.steps.some((s) => s.status !== 'applied' && s.status !== 'already-resolved') ? 1 : 0;
}
