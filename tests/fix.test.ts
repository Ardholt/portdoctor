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

test('fix loop end to end: propose -> git apply --check -> apply on a copy -> check -> re-scan; findings go 5 -> 0, original untouched', { skip: !hasGcc && 'no gcc' }, () => {
  const d = demoCopy();
  try {
    const orig = readFileSync(join(d, 'main.c'), 'utf8');
    const r = runFix(d, { provider: STUB, count: 5 });
    assert.equal(r.before.findings, 5);
    assert.equal(r.after.findings, 0);
    assert.deepEqual(r.steps.map((s) => s.status), ['applied', 'applied', 'applied', 'applied', 'applied']);
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

test('providers/cli-provider.sh: exits 3 with a clear message when the LLM CLI is missing; passes the prompt on stdin when present', () => {
  const sh = join(ROOT, 'providers', 'cli-provider.sh');
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
    const r = spawnSync('node', [join(ROOT, 'bin', 'portdoctor.mjs'), 'fix', d, '--provider', STUB, '--count', '5', '-o', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /before: 3 findings/, 'the bundled SDP manifest is the default: pipe2/SOCK_NONBLOCK are not reported');
    assert.match(r.stdout, /after:  0 findings/);
    assert.match(readFileSync(out, 'utf8'), /PortDoctor fix report/);
    assert.equal(scanDir(d).findings.length, 5);
    const plain = spawnSync('node', [join(ROOT, 'bin', 'portdoctor.mjs'), 'fix', d, '--provider', STUB, '--count', '5', '--no-sdp-manifest', '-o', out], { encoding: 'utf8' });
    assert.match(plain.stdout, /before: 5 findings/, '--no-sdp-manifest restores the unverified scan');
  } finally {
    rmSync(dirname(d), { recursive: true, force: true });
  }
});

test('a failing provider is reported with its stdout/stderr text and a hint, never an empty "provider exit 1:"', () => {
  const d = demoCopy();
  try {
    const r = runFix(d, { provider: `sh -c 'echo "Not logged in - Please run /login"; exit 1'`, count: 1 });
    assert.equal(r.steps[0].status, 'provider-failed');
    assert.match(r.steps[0].detail, /exited with status 1: Not logged in/);
    assert.match(r.steps[0].detail, /Hint: the model CLI is not logged in/);
    const silent = runFix(d, { provider: 'sh -c "exit 1"', count: 1 });
    assert.match(silent.steps[0].detail, /printed nothing/);
    rmSync(r.workDir, { recursive: true, force: true });
    rmSync(silent.workDir, { recursive: true, force: true });
  } finally {
    rmSync(join(d, '..'), { recursive: true, force: true });
  }
});

// qcc is faked here (a shell script that behaves like the SDP linker for three libraries) so the build-file check logic runs without an SDP.
function fakeQccEnv(): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), 'pd-fakeqcc-'));
  writeFileSync(join(dir, 'qcc'), '#!/bin/sh\nfor a in "$@"; do case "$a" in -lrt|-lpthread|-ldl) echo "ld: cannot find $a" >&2; exit 1;; esac; done\ncat >/dev/null 2>&1 </dev/null\nexit 0\n');
  chmodSync(join(dir, 'qcc'), 0o755);
  return { dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } };
}
const hasMake = spawnSync('make', ['--version']).status === 0;

test('qcc check understands Makefiles: make -n plus a link probe per -l library; a Makefile that links -lrt fails, one without it passes', { skip: !hasMake }, async () => {
  const { runBuildCheck } = await import('../src/fix.ts');
  const { dir, env } = fakeQccEnv();
  const saved = process.env.PATH;
  process.env.PATH = env.PATH;
  const d = demoCopy();
  try {
    const bad = runBuildCheck('make', d, 'Makefile', 'gcc_ntox86_64');
    assert.equal(bad.status, 'fail');
    assert.match(bad.output, /-lrt: cannot find -lrt/);
    writeFileSync(join(d, 'Makefile'), readFileSync(join(d, 'Makefile'), 'utf8').replace('LDLIBS = -lrt', 'LDLIBS ='));
    const good = runBuildCheck('make', d, 'Makefile', 'gcc_ntox86_64');
    assert.equal(good.status, 'pass', good.output);
    writeFileSync(join(d, 'Makefile'), 'all:\n\t$(CC) -o x x.c\nbroken line without a tab\n');
    assert.equal(runBuildCheck('make', d, 'Makefile', 'gcc_ntox86_64').status, 'fail');
  } finally {
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(d, '..'), { recursive: true, force: true });
  }
});

test('fix loop with --check qcc: a Makefile patch is no longer "skipped" (checked by make -n and the link probe)', { skip: !hasMake }, () => {
  const { dir, env } = fakeQccEnv();
  const d = demoCopy();
  try {
    const patch = JSON.stringify({ unifiedDiff: 'diff --git a/Makefile b/Makefile\n--- a/Makefile\n+++ b/Makefile\n@@ -1,2 +1,2 @@\n-LDLIBS = -lrt\n+LDLIBS =\n \n all: demo\n', explanation: 'drop -lrt', assumptions: [], confidence: 'high', needsHuman: false });
    const prov = join(dir, 'prov.sh');
    writeFileSync(prov, `#!/bin/sh\ncat >/dev/null\nprintf '%s' '${patch.replace(/'/g, "'\\''")}'\n`);
    chmodSync(prov, 0o755);
    const saved = process.env.PATH;
    process.env.PATH = env.PATH;
    try {
      const r = runFix(d, { provider: prov, check: 'qcc', rules: ['QNX-BLD-LRT'], count: 1 });
      assert.equal(r.steps[0].status, 'applied', JSON.stringify(r.steps[0]));
      assert.equal(r.steps[0].check?.status, 'pass');
      assert.equal(r.steps[0].check?.baselineErrors, 1);
      assert.match(r.steps[0].check!.output, /make -n/);
      rmSync(r.workDir, { recursive: true, force: true });
    } finally {
      process.env.PATH = saved;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(d, '..'), { recursive: true, force: true });
  }
});
