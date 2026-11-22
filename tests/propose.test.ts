import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { scanDir } from '../src/scan.ts';
import { buildRequest, readWindow, validateAgainstSchema, PATCH_SCHEMA, checkPatchApplies, evaluateResponse, parseProviderOutput } from '../src/propose.ts';

const SRC = 'int main(void) {\n  int e = pipe2(0, 0);\n  return e;\n}\n';
const DIFF = '--- a/a.c\n+++ b/a.c\n@@ -1,4 +1,4 @@\n int main(void) {\n-  int e = pipe2(0, 0);\n+  int e = pipe(0);\n   return e;\n }\n';

function fixture() {
  const d = mkdtempSync(join(tmpdir(), 'pd-'));
  writeFileSync(join(d, 'a.c'), SRC);
  return d;
}

test('request carries finding, remedy, schema and numbered window', () => {
  const d = fixture();
  try {
    const f = scanDir(d).findings.find((x) => x.ruleId === 'QNX-API-PIPE2')!;
    const req = buildRequest(f, readWindow(d, f));
    assert.match(req.prompt, /QNX-API-PIPE2/);
    assert.match(req.prompt, /Do NOT invent header contents/);
    assert.match(req.window.text, /^\s+1\| int main/);
    assert.equal(req.schema, PATCH_SCHEMA);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('schema validation catches missing, extra and mistyped fields', () => {
  const good = { unifiedDiff: '', explanation: 'x', assumptions: [], confidence: 'low', needsHuman: true };
  assert.deepEqual(validateAgainstSchema(good, PATCH_SCHEMA), []);
  assert.ok(validateAgainstSchema({ ...good, confidence: 'certain' }, PATCH_SCHEMA).length);
  assert.ok(validateAgainstSchema({ ...good, extra: 1 }, PATCH_SCHEMA).length);
  assert.ok(validateAgainstSchema({ ...good, assumptions: [1] }, PATCH_SCHEMA).length);
  const { explanation, ...missing } = good;
  assert.ok(validateAgainstSchema(missing, PATCH_SCHEMA).some((e) => /explanation/.test(e)));
});

test('git apply --check accepts a good patch and rejects a stale one', () => {
  const d = fixture();
  try {
    assert.equal(checkPatchApplies(DIFF, d).ok, true);
    assert.equal(checkPatchApplies(DIFF.replace('pipe2(0, 0)', 'other(0)'), d).ok, false);
    assert.equal(checkPatchApplies('', d).ok, false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('patch paths escaping the root are refused before git runs', () => {
  const d = fixture();
  try {
    const bad = checkPatchApplies('--- a/../x\n+++ b/../x\n@@ -0,0 +1 @@\n+x\n', d);
    assert.equal(bad.ok, false);
    assert.match(bad.detail, /escapes/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('evaluateResponse: accepted / schema / apply / needsHuman', () => {
  const d = fixture();
  try {
    const base = { unifiedDiff: DIFF, explanation: 'x', assumptions: [], confidence: 'medium', needsHuman: false };
    assert.equal(evaluateResponse(base, d).ok, true);
    assert.equal(evaluateResponse({ ...base, confidence: 'z' }, d).stage, 'schema');
    assert.equal(evaluateResponse({ ...base, unifiedDiff: 'garbage' }, d).stage, 'apply');
    assert.equal(evaluateResponse({ ...base, unifiedDiff: '', needsHuman: true }, d).ok, false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('parseProviderOutput accepts fenced JSON', () => {
  assert.deepEqual(parseProviderOutput('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseProviderOutput('nope'));
});

test('CLI: no provider prints the request; stub provider is piped the request and its patch is checked', () => {
  const d = fixture();
  const bin = join(import.meta.dirname, '..', 'bin', 'portdoctor.mjs');
  const stub = join(tmpdir(), `pd-stub-${process.pid}.mjs`);
  try {
    const idx = scanDir(d).findings.findIndex((x) => x.ruleId === 'QNX-API-PIPE2');
    const dry = spawnSync(process.execPath, [bin, 'propose', d, '--finding', String(idx)], { encoding: 'utf8' });
    assert.equal(dry.status, 0);
    assert.equal(JSON.parse(dry.stdout).outcome.stage, 'prompt-only');
    writeFileSync(stub, `let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const r=JSON.parse(s);if(!r.prompt||!r.schema||!r.window)process.exit(9);console.log(JSON.stringify({unifiedDiff:${JSON.stringify(DIFF)},explanation:'stub',assumptions:[],confidence:'low',needsHuman:false}))})`);
    const ok = spawnSync(process.execPath, [bin, 'propose', d, '--finding', String(idx), '--provider', `"${process.execPath}" "${stub}"`], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    assert.equal(JSON.parse(ok.stdout).ok, true);
    const fail = spawnSync(process.execPath, [bin, 'propose', d, '--finding', String(idx), '--provider', 'exit 7'], { encoding: 'utf8' });
    assert.equal(fail.status, 3);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(stub, { force: true });
  }
});
