import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runFix, fixHtml } from '../src/fix.ts';
import { scanDir } from '../src/scan.ts';

// No model is called here: the provider is examples/stub-provider.mjs (deterministic) or a canned-output script.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = `node ${join(ROOT, 'examples', 'stub-provider.mjs')}`;
const DEMO = join(ROOT, 'examples', 'demo');
const hasGcc = spawnSync('gcc', ['--version']).status === 0;

function demoCopy(): string {
  const d = mkdtempSync(join(tmpdir(), 'pd-fix-'));
  cpSync(DEMO, join(d, 'demo'), { recursive: true });
  return join(d, 'demo');
}

test('fix loop end to end: propose -> git apply --check -> apply on a copy -> check -> re-scan; findings go 4 -> 0, original untouched', { skip: !hasGcc && 'no gcc' }, () => {
  const d = demoCopy();
  try {
    const orig = readFileSync(join(d, 'main.c'), 'utf8');
    const r = runFix(d, { provider: STUB, count: 4 });
    assert.equal(r.before.findings, 4);
    assert.equal(r.after.findings, 0);
    assert.deepEqual(r.steps.map((s) => s.status), ['applied', 'applied', 'applied', 'applied']);
    assert.ok(r.steps.filter((s) => s.file === 'main.c').every((s) => s.check?.status === 'pass'));
    assert.equal(r.steps.find((s) => s.file === 'Makefile')!.check?.status, 'skipped');
    assert.equal(readFileSync(join(d, 'main.c'), 'utf8'), orig, 'original tree must not change');
    assert.doesNotMatch(readFileSync(join(r.workDir, 'main.c'), 'utf8'), /pipe2|SOCK_NONBLOCK|\/dev\/shm/);
    const html = fixHtml(r);
    assert.match(html, /findings before/);
    assert.match(html, /host gcc syntax-only/);
    assert.match(html, /qcc check will replace it/);
    rmSync(r.workDir, { recursive: true, force: true });
  } finally {
    rmSync(dirname(d), { recursive: true, force: true });
  }
});

test('a patch that fails the compile check is reverted and the finding stays', { skip: !hasGcc && 'no gcc' }, () => {
  const d = demoCopy();
  try {
    process.env.STUB_MODE = 'break';
    const r = runFix(d, { provider: STUB, count: 1, rules: ['QNX-API-PIPE2'] });
    delete process.env.STUB_MODE;
    assert.equal(r.steps[0].status, 'check-failed');
    assert.equal(r.steps[0].check?.status, 'fail');
    assert.equal(r.after.findings, r.before.findings);
    assert.match(readFileSync(join(r.workDir, 'main.c'), 'utf8'), /pipe2/);
    rmSync(r.workDir, { recursive: true, force: true });
  } finally {
    delete process.env.STUB_MODE;
    rmSync(dirname(d), { recursive: true, force: true });
  }
});

test('--check is pluggable: a custom command decides pass or fail with {file}', () => {
  const d = demoCopy();
  try {
    const ok = runFix(d, { provider: STUB, count: 1, rules: ['QNX-API-PIPE2'], check: 'test -f {file}' });
    assert.equal(ok.steps[0].status, 'applied');
    assert.equal(ok.steps[0].check?.status, 'pass');
    const bad = runFix(d, { provider: STUB, count: 1, rules: ['QNX-API-PIPE2'], check: 'false' });
    assert.equal(bad.steps[0].status, 'check-failed');
    for (const r of [ok, bad]) rmSync(r.workDir, { recursive: true, force: true });
  } finally {
    rmSync(dirname(d), { recursive: true, force: true });
  }
});

test('provider that declines or fails is reported, not applied', () => {
  const d = demoCopy();
  try {
    writeFileSync(join(d, 'e.c'), 'int f(void){ return epoll_create1(0); }\n');
    const declined = runFix(d, { provider: STUB, count: 1, rules: ['QNX-API-EPOLL'] });
    assert.equal(declined.steps[0].status, 'rejected');
    assert.equal(declined.after.findings, declined.before.findings);
    const failed = runFix(d, { provider: 'exit 3', count: 1 });
    assert.equal(failed.steps[0].status, 'provider-failed');
    for (const r of [declined, failed]) rmSync(r.workDir, { recursive: true, force: true });
  } finally {
    rmSync(dirname(d), { recursive: true, force: true });
  }
});

test('a patch touching paths outside the project is refused', () => {
  const d = demoCopy();
  try {
    const evil = join(dirname(d), 'evil.sh');
    const data = join(dirname(d), 'evil.json');
    writeFileSync(data, JSON.stringify({ unifiedDiff: '--- a/../x\n+++ b/../x\n@@ -1 +1 @@\n-a\n+b\n', explanation: 'x', assumptions: [], confidence: 'low', needsHuman: false }));
    writeFileSync(evil, `#!/bin/sh\ncat >/dev/null\ncat ${data}\n`);
    chmodSync(evil, 0o755);
    const r = runFix(d, { provider: evil, count: 1 });
    assert.equal(r.steps[0].status, 'rejected');
    assert.match(r.steps[0].detail, /escapes/);
    rmSync(r.workDir, { recursive: true, force: true });
  } finally {
    rmSync(dirname(d), { recursive: true, force: true });
  }
});

test('providers/claude-cli.sh: exits 3 with a clear message when the LLM CLI is missing; passes the prompt on stdin when present', () => {
  const sh = join(ROOT, 'providers', 'claude-cli.sh');
  const req = JSON.stringify({ prompt: 'PROMPT-X', schema: { type: 'object' }, finding: {}, window: {} });
  const missing = spawnSync(sh, [], { input: req, encoding: 'utf8', env: { ...process.env, PD_LLM_CMD: 'definitely-not-a-real-llm-cli -p' } });
  assert.equal(missing.status, 3);
  assert.match(missing.stderr, /not found on PATH/);
  const d = mkdtempSync(join(tmpdir(), 'pd-prov-'));
  try {
    const fake = join(d, 'fake-llm');
    writeFileSync(fake, '#!/bin/sh\nIN=$(cat)\ncase "$IN" in *PROMPT-X*JSON\\ schema*) echo \'{"ok":"saw prompt and schema"}\';; *) echo bad; exit 9;; esac\n');
    chmodSync(fake, 0o755);
    const ok = spawnSync(sh, [], { input: req, encoding: 'utf8', env: { ...process.env, PD_LLM_CMD: fake } });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /saw prompt and schema/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('CLI fix exits 0 on full success and writes the report', { skip: !hasGcc && 'no gcc' }, () => {
  const d = demoCopy();
  try {
    const out = join(dirname(d), 'fix-report.html');
    const r = spawnSync('node', [join(ROOT, 'bin', 'portdoctor.mjs'), 'fix', d, '--provider', STUB, '--count', '4', '-o', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /before: 4 findings/);
    assert.match(r.stdout, /after:  0 findings/);
    assert.match(readFileSync(out, 'utf8'), /PortDoctor fix report/);
    assert.equal(scanDir(d).findings.length, 4);
  } finally {
    rmSync(dirname(d), { recursive: true, force: true });
  }
});
