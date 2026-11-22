import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scanDir } from '../src/scan.ts';
import { toSarif } from '../src/sarif.ts';
import { toolchainCmake, portabilityHeader } from '../src/init.ts';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'portdoctor.mjs');

function proj(): string {
  const d = mkdtempSync(join(tmpdir(), 'pd-art-'));
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src', 'a.c'), 'int f(void){ int e = epoll_create1(0); return pipe2(0, 0) + e; }\n');
  writeFileSync(join(d, 'Makefile'), 'LDLIBS = -lrt\n');
  return d;
}

test('SARIF: 2.1.0 structure, rule indexes consistent, relative uris, levels mapped', () => {
  const d = proj();
  try {
    const r = scanDir(d);
    const s: any = toSarif(r);
    assert.equal(s.version, '2.1.0');
    assert.match(s.$schema, /sarif-2\.1\.0/);
    const run = s.runs[0];
    assert.equal(run.tool.driver.name, 'portdoctor');
    assert.equal(run.results.length, r.findings.length);
    for (const res of run.results) {
      assert.equal(run.tool.driver.rules[res.ruleIndex].id, res.ruleId);
      assert.ok(['error', 'warning', 'note'].includes(res.level));
      const loc = res.locations[0].physicalLocation;
      assert.doesNotMatch(loc.artifactLocation.uri, /^\/|\\|\.\./);
      assert.ok(loc.region.startLine >= 1);
    }
    assert.equal(run.results.find((x: any) => x.ruleId === 'QNX-API-EPOLL').level, 'error');
    assert.equal(run.results.find((x: any) => x.ruleId === 'QNX-API-PIPE2').level, 'note');
    assert.doesNotMatch(JSON.stringify(s), new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('CLI --sarif writes valid JSON and still honours --fail-on', () => {
  const d = proj();
  try {
    const out = join(d, 'o.sarif');
    const r = spawnSync('node', [BIN, 'scan', d, '--sarif', '-o', out, '--fail-on', 'blocker'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).version, '2.1.0');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('toolchain file carries only the recalled facts and labels them unverified', () => {
  const t = toolchainCmake('aarch64le');
  assert.match(t, /set\(CMAKE_SYSTEM_NAME QNX\)/);
  assert.match(t, /set\(CMAKE_C_COMPILER qcc\)/);
  assert.match(t, /set\(CMAKE_CXX_COMPILER q\+\+\)/);
  assert.match(t, /-Vgcc_ntoaarch64le/);
  assert.match(t, /NOT verified against an SDP/);
  assert.match(toolchainCmake('x86_64'), /gcc_ntox86_64/);
  assert.throws(() => toolchainCmake('mips'), /--arch/);
});

test('portability.h lists flagged APIs with TODO and invents no API', () => {
  const d = proj();
  try {
    const h = portabilityHeader(scanDir(d));
    assert.match(h, /#if defined\(__QNXNTO__\)/);
    assert.match(h, /QNX-API-EPOLL/);
    assert.match(h, /TODO/);
    assert.match(h, /src\/a\.c:1/);
    assert.doesNotMatch(h, /#define\s+(?!PORTABILITY_H)/, 'must not define anything it cannot know');
    assert.doesNotMatch(h, /QNX-BLD-/, 'build rules are not API shims');
    assert.match(portabilityHeader(null), /No flagged APIs/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('init-toolchain writes both files, refuses to overwrite without --force', () => {
  const d = proj();
  const out = join(d, 'out');
  try {
    const r = spawnSync('node', [BIN, 'init-toolchain', d, '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(out, 'qnx-toolchain.cmake')) && existsSync(join(out, 'portability.h')));
    const again = spawnSync('node', [BIN, 'init-toolchain', d, '--out', out], { encoding: 'utf8' });
    assert.equal(again.status, 2);
    assert.match(again.stderr, /--force/);
    assert.equal(spawnSync('node', [BIN, 'init-toolchain', d, '--out', out, '--force'], { encoding: 'utf8' }).status, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
