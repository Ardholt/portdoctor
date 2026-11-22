import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanDir } from './scan.ts';
import type { Finding, ScanResult } from './types.ts';

/**
 * AI hook (interface only). PortDoctor never calls a model. It builds a request
 * (prompt + JSON schema + code window), hands it to a provider command you
 * supply on stdin, reads one JSON response from its stdout, validates it against
 * the schema and checks that the patch applies with `git apply --check`.
 */

export const PATCH_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PortDoctorPatchProposal',
  type: 'object',
  additionalProperties: false,
  required: ['unifiedDiff', 'explanation', 'assumptions', 'confidence', 'needsHuman'],
  properties: {
    unifiedDiff: { type: 'string', description: 'Unified diff, paths relative to the scan root (a/ b/ prefixes, apply with -p1). Empty string if no safe patch exists.' },
    explanation: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'QNX facts the patch relies on that were not verified.' },
    verifyAgainstSdp: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    needsHuman: { type: 'boolean' },
  },
} as const;

export interface ProposeRequest {
  schemaVersion: 1;
  prompt: string;
  schema: typeof PATCH_SCHEMA;
  finding: Finding;
  window: { file: string; startLine: number; endLine: number; text: string };
}

/** A provider that exits without reading its stdin makes spawnSync report EPIPE next to a real exit status: that is not a failure to run. */
export function providerFailed(pr: { error?: Error; status: number | null }): boolean {
  const epipe = (pr.error as NodeJS.ErrnoException | undefined)?.code === 'EPIPE' && pr.status !== null;
  return (!!pr.error && !epipe) || pr.status !== 0;
}

/** One readable line for a failed provider process: both streams (some CLIs report errors on stdout) and a hint. */
export function describeProviderFailure(pr: { error?: Error; status: number | null; stdout?: string | null; stderr?: string | null }): string {
  const text = `${pr.stderr ?? ''} ${pr.stdout ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 600);
  const epipe = (pr.error as NodeJS.ErrnoException | undefined)?.code === 'EPIPE' && pr.status !== null;
  const head = pr.error && !epipe ? `provider could not run (${pr.error.message})` : `provider exited with status ${pr.status}`;
  let hint = '';
  if (/not logged in|login|oauth|authenticat/i.test(text)) hint = ' Hint: the model CLI is not logged in; log in, or point --provider at another command (providers/replay.mjs replays recorded patches).';
  else if (/rate|limit|refused|quota|overloaded/i.test(text)) hint = ' Hint: the model account is rate-limited or refused; retry later or use another account.';
  else if (!text) hint = ' Hint: the provider printed nothing; run it by hand with a request on stdin to see why.';
  return `${head}${text ? ': ' + text : ''}.${hint}`;
}

export function readWindow(root: string, f: Finding, radius = 15): ProposeRequest['window'] {
  const abs = resolve(root, f.file);
  const lines = readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const start = Math.max(1, f.line - radius);
  const end = Math.min(lines.length, f.line + radius);
  const text = lines
    .slice(start - 1, end)
    .map((t, i) => `${String(start + i).padStart(5)}| ${t}`)
    .join('\n');
  return { file: f.file, startLine: start, endLine: end, text };
}

export function buildRequest(f: Finding, window: ProposeRequest['window']): ProposeRequest {
  const prompt = [
    'You are helping port a Linux/POSIX C/C++ project to QNX 8.0.',
    'A static scanner reported the finding below. Propose the smallest patch that resolves it.',
    '',
    `Rule: ${f.ruleId} (${f.severity}, confidence ${f.confidence})`,
    `Problem: ${f.message}`,
    `Suggested direction: ${f.remedy}`,
    f.verify ? `Scanner note: ${f.verify}` : '',
    `Location: ${f.file}:${f.line}`,
    '',
    `Code window (${window.file}, lines ${window.startLine}-${window.endLine}, line numbers are not part of the file):`,
    window.text,
    '',
    'Rules for your answer:',
    '- Reply with ONE JSON object that matches the supplied JSON schema and nothing else.',
    '- unifiedDiff must be a unified diff with a/ b/ path prefixes relative to the project root, applicable with `git apply`.',
    '- Keep the Linux code path working (guard with #if defined(__QNXNTO__) or equivalent) unless the code is Linux-only by design.',
    '- Only use QNX APIs you can name from public documentation. Do NOT invent header contents, constants or function signatures.',
    '- List every QNX fact you relied on but could not verify in `assumptions` and `verifyAgainstSdp`.',
    '- If no safe patch exists, set unifiedDiff to "" and needsHuman to true.',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
  return { schemaVersion: 1, prompt, schema: PATCH_SCHEMA, finding: f, window };
}

type Json = unknown;
export function validateAgainstSchema(value: Json, schema: any, path = '$'): string[] {
  const errs: string[] = [];
  const t = schema.type;
  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (t && kind !== t) return [`${path}: expected ${t}, got ${kind}`];
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: must be one of ${schema.enum.join('|')}`);
  if (t === 'object') {
    const o = value as Record<string, Json>;
    for (const k of schema.required ?? []) if (!(k in o)) errs.push(`${path}.${k}: required`);
    for (const k of Object.keys(o)) {
      if (schema.properties?.[k]) errs.push(...validateAgainstSchema(o[k], schema.properties[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: unexpected property`);
    }
  }
  if (t === 'array' && schema.items) (value as Json[]).forEach((v, i) => errs.push(...validateAgainstSchema(v, schema.items, `${path}[${i}]`)));
  return errs;
}

export function patchPaths(diff: string): string[] {
  const out: string[] = [];
  for (const l of diff.split('\n')) {
    const m = /^(?:---|\+\+\+) (?:[ab]\/)?(\S+)/.exec(l);
    if (m && m[1] !== '/dev/null') out.push(m[1]);
  }
  return out;
}

export function checkPatchApplies(diff: string, root: string): { ok: boolean; detail: string } {
  if (!diff.trim()) return { ok: false, detail: 'empty diff' };
  for (const p of patchPaths(diff)) {
    if (isAbsolute(p) || p.split('/').includes('..')) return { ok: false, detail: `patch path escapes the project root: ${p}` };
  }
  {
    const r = spawnSync('git', ['apply', '--check', '-p1', '-'], { cwd: root, input: diff.endsWith('\n') ? diff : diff + '\n', encoding: 'utf8' });
    if (r.error) return { ok: false, detail: `could not run git: ${r.error.message}` };
    return { ok: r.status === 0, detail: (r.stderr || r.stdout || '').trim() || (r.status === 0 ? 'git apply --check passed' : 'git apply --check failed') };
  }
}

export function parseProviderOutput(out: string): Json {
  const t = out.trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
    if (m) return JSON.parse(m[1]);
    throw new Error('provider output is not valid JSON');
  }
}

export interface ProposeOutcome {
  ok: boolean;
  stage: 'prompt-only' | 'provider' | 'schema' | 'apply' | 'accepted';
  errors: string[];
  response?: Json;
  applyCheck?: string;
}

export function evaluateResponse(resp: Json, root: string): ProposeOutcome {
  const errors = validateAgainstSchema(resp, PATCH_SCHEMA);
  if (errors.length) return { ok: false, stage: 'schema', errors, response: resp };
  const r = resp as { unifiedDiff: string; needsHuman: boolean };
  if (r.needsHuman && !r.unifiedDiff.trim()) return { ok: false, stage: 'accepted', errors: ['model reports no safe patch (needsHuman)'], response: resp };
  const c = checkPatchApplies(r.unifiedDiff, root);
  if (!c.ok) return { ok: false, stage: 'apply', errors: [c.detail], response: resp, applyCheck: c.detail };
  return { ok: true, stage: 'accepted', errors: [], response: resp, applyCheck: c.detail };
}

function takeOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined) throw new Error(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}

/** Exit codes: 0 ok / prompt printed, 1 response rejected, 3 provider failed. */
export async function runPropose(argv: string[]): Promise<number> {
  const args = argv.slice();
  if (args.includes('--schema')) {
    process.stdout.write(JSON.stringify(PATCH_SCHEMA, null, 2) + '\n');
    return 0;
  }
  const idxS = takeOpt(args, '--finding');
  const provider = takeOpt(args, '--provider');
  const patchFile = takeOpt(args, '--patch-file');
  const rootOpt = takeOpt(args, '--root');
  const radius = Number(takeOpt(args, '--window') ?? 15);
  const src = args.shift();
  if (!src || idxS === undefined) throw new Error('usage: portdoctor propose <scan.json|dir> --finding <n> [--root <dir>] [--provider "<cmd>"] [--patch-file <f>]');
  let res: ScanResult;
  let root: string;
  if (existsSync(src) && statSync(src).isDirectory()) {
    root = resolve(src);
    res = scanDir(root);
  } else {
    res = JSON.parse(readFileSync(src, 'utf8')) as ScanResult;
    if (!rootOpt) throw new Error('--root <dir> is required when proposing from a scan.json');
    root = resolve(rootOpt);
  }
  const f = res.findings[Number(idxS)];
  if (!f) throw new Error(`no finding #${idxS} (0..${res.findings.length - 1})`);
  const req = buildRequest(f, readWindow(root, f, radius));

  let resp: Json;
  if (patchFile) resp = parseProviderOutput(readFileSync(patchFile, 'utf8'));
  else if (provider) {
    const r = spawnSync(provider, { shell: true, input: JSON.stringify(req), encoding: 'utf8', timeout: 300_000, maxBuffer: 16 << 20 });
    if (providerFailed(r)) {
      process.stderr.write(`provider failed: ${describeProviderFailure(r)}\n`);
      return 3;
    }
    try {
      resp = parseProviderOutput(r.stdout);
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      return 1;
    }
  } else {
    process.stdout.write(JSON.stringify({ ...req, outcome: { ok: true, stage: 'prompt-only', errors: [] } }, null, 2) + '\n');
    return 0;
  }
  const outcome = evaluateResponse(resp, root);
  process.stdout.write(JSON.stringify(outcome, null, 2) + '\n');
  return outcome.ok ? 0 : 1;
}
