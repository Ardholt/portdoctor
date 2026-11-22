import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadRules } from '../src/rules.ts';
import { scanText, scanDir, maskC, detectKind } from '../src/scan.ts';
import { renderHtml } from '../src/report-html.ts';

const rules = loadRules();
const ids = (t: string) => scanText('a.c', 'c', t, rules).map((f) => f.ruleId);

test('comments and string literals do not trigger code rules', () => {
  assert.deepEqual(ids('// epoll_create1(0)\n/* inotify_init() */\nconst char *s = "epoll_wait";\n'), []);
});

test('block comment spanning lines keeps line numbers', () => {
  const f = scanText('a.c', 'c', '/* a\n b\n c */\nint x = epoll_create1(0);\n', rules).find((x) => x.ruleId === 'QNX-API-EPOLL')!;
  assert.equal(f.line, 4);
  assert.equal(f.context.find((c) => c.n === 4)!.text, 'int x = epoll_create1(0);');
});

test('CRLF files report the right line', () => {
  const f = scanText('a.c', 'c', 'int a;\r\nint b;\r\nint c = eventfd(0,0);\r\n', rules).find((x) => x.ruleId === 'QNX-API-EVENTFD')!;
  assert.equal(f.line, 3);
});

test('findings inside #ifdef __QNXNTO__ are suppressed and counted', () => {
  const counters = { suppressed: 0 };
  const out = scanText('a.c', 'c', '#ifdef __QNXNTO__\nint e = epoll_create1(0);\n#endif\n', rules, 3, counters);
  assert.equal(out.filter((f) => f.ruleId === 'QNX-API-EPOLL').length, 0);
  assert.equal(counters.suppressed, 1);
});

test('#ifndef __linux__ ... #else marks the #else side as Linux-only', () => {
  const src = '#ifndef __linux__\nint a;\n#else\nint e = epoll_create1(0);\n#endif\n';
  const f = scanText('a.c', 'c', src, rules).find((x) => x.ruleId === 'QNX-API-EPOLL')!;
  assert.equal(f.guard, 'linux-only');
});

test('non-platform guards are recorded but not judged', () => {
  const f = scanText('a.c', 'c', '#ifdef HAVE_EPOLL\nint e = epoll_create1(0);\n#endif\n', rules).find((x) => x.ruleId === 'QNX-API-EPOLL')!;
  assert.equal(f.guard, 'other');
  assert.deepEqual(f.guards, ['#ifdef HAVE_EPOLL']);
});

test('one finding per rule per line', () => {
  const n = scanText('a.c', 'c', 'int x = epoll_create1(0) + epoll_ctl(1,2,3,0);\n', rules).filter((f) => f.ruleId === 'QNX-API-EPOLL');
  assert.equal(n.length, 1);
});

test('maskC preserves length and newlines', () => {
  const s = 'a /* x\ny */ "str\\"ing" \'c\' // end\nz';
  const m = maskC(s);
  assert.equal(m.noComment.length, s.length);
  assert.equal(m.code.length, s.length);
  assert.equal(m.code.split('\n').length, 3);
});

test('detectKind', () => {
  assert.equal(detectKind('CMakeLists.txt'), 'cmake');
  assert.equal(detectKind('foo.cmake'), 'cmake');
  assert.equal(detectKind('Makefile'), 'make');
  assert.equal(detectKind('Makefile.in'), null);
  assert.equal(detectKind('configure.ac'), 'autoconf');
  assert.equal(detectKind('x.hpp'), 'c');
  assert.equal(detectKind('x.py'), null);
});

test('scanDir skips binary and .git, reports relative posix paths, leaks no absolute path', () => {
  const d = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    mkdirSync(join(d, 'src'));
    mkdirSync(join(d, '.git'));
    writeFileSync(join(d, 'src', 'a.c'), 'int e = epoll_create1(0);\n');
    writeFileSync(join(d, '.git', 'b.c'), 'int e = epoll_create1(0);\n');
    writeFileSync(join(d, 'bin.c'), Buffer.from([0x65, 0, 0x70]));
    const r = scanDir(d);
    assert.deepEqual(r.findings.map((f) => f.file), ['src/a.c']);
    assert.equal(r.stats.filesSkipped, 1);
    assert.ok(!JSON.stringify(r).includes(d), 'absolute path leaked into result');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('HTML report escapes hostile content', () => {
  const d = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    writeFileSync(join(d, 'a.c'), 'int e = epoll_create1(0); /* </script><img src=x onerror=alert(1)> */ const char *s = "<b>";\nint f = eventfd(0,0);// </script>\n');
    const h = renderHtml(scanDir(d));
    assert.ok(!/<img src=x/.test(h));
    assert.equal((h.match(/<script/g) ?? []).length, 2);
    assert.match(h, /lang="en"/);
    assert.match(h, /prefers-color-scheme/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('CLI --json and --fail-on exit code', () => {
  const d = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    writeFileSync(join(d, 'a.c'), 'int e = epoll_create1(0);\n');
    const bin = join(import.meta.dirname, '..', 'bin', 'portdoctor.mjs');
    const r = spawnSync(process.execPath, [bin, 'scan', d, '--json', '--fail-on', 'blocker'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    const j = JSON.parse(r.stdout);
    assert.equal(j.findings[0].ruleId, 'QNX-API-EPOLL');
    writeFileSync(join(d, 'a.c'), 'int ok;\n');
    const clean = spawnSync(process.execPath, [bin, 'scan', d, '--fail-on', 'info'], { encoding: 'utf8' });
    assert.equal(clean.status, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
