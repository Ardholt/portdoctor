import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanDir } from '../src/scan.ts';
import { loadManifest, classify } from '../src/sdp.ts';

const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sdp-8.0-manifest.json');
const m = loadManifest(MANIFEST);

function proj(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'pd-sdp-'));
  for (const [n, t] of Object.entries(files)) { mkdirSync(dirname(join(d, n)), { recursive: true }); writeFileSync(join(d, n), t); }
  return d;
}

test('manifest is derived facts only and says which build it came from', () => {
  assert.match(String(m.sdp.build), /^8\.0\.0\./);
  const s = JSON.stringify(m);
  assert.ok(Object.keys(m.names).length > 400);
  assert.ok(s.length < 2_000_000);
});

test('classify: names, headers, libs, flags', () => {
  assert.equal(classify({ ruleId: 'QNX-API-EPOLL', match: 'epoll_create1' }, m)?.verdict, 'absent');
  assert.equal(classify({ ruleId: 'QNX-API-SOCK-FLAGS', match: 'SOCK_NONBLOCK' }, m)?.verdict, 'present');
  assert.equal(classify({ ruleId: 'QNX-API-INOTIFY', match: 'inotify_init1' }, m)?.items[0].needsLib, '-lfsnotify');
  assert.equal(classify({ ruleId: 'QNX-HDR-SYS-LINUX', match: '#include <sys/epoll.h>' }, m)?.verdict, 'absent');
  assert.equal(classify({ ruleId: 'QNX-HDR-SYS-LINUX', match: '#include <sys/inotify.h>' }, m)?.verdict, 'present');
  assert.equal(classify({ ruleId: 'QNX-BLD-LRT', match: '-lrt' }, m)?.verdict, 'absent');
  assert.equal(classify({ ruleId: 'QNX-BLD-LNSL', match: '-lutil' }, m)?.verdict, 'absent');
  assert.equal(classify({ ruleId: 'QNX-BLD-FPIC', match: '-fPIC' }, m)?.verdict, 'present');
  assert.equal(classify({ ruleId: 'QNX-API-EPOLL', match: 'a_name_not_in_the_manifest_xyz' }, m), null);
});

test('scan --sdp-manifest: absent stays a finding with evidence, present is dropped, inotify is kept as info with its library', () => {
  const d = proj({
    'a.c': '#include <sys/epoll.h>\n#include <sys/socket.h>\nint f(int e){ return epoll_create1(0); }\nint g(void){ return socket(2, SOCK_STREAM | SOCK_NONBLOCK, 0); }\nint h(void){ return inotify_init1(0); }\n',
    'Makefile': 'LDLIBS = -lrt -lm\n',
  });
  const plain = scanDir(d, {});
  const r = scanDir(d, { sdp: m });
  const ids = (x: typeof r) => x.findings.map((f) => f.ruleId + ':' + f.match);
  assert.ok(ids(plain).some((x) => x.startsWith('QNX-API-SOCK-FLAGS')), 'without the manifest SOCK_NONBLOCK is reported');
  assert.ok(!ids(r).some((x) => x.startsWith('QNX-API-SOCK-FLAGS')), 'with the manifest it is dropped');
  const ep = r.findings.find((f) => f.ruleId === 'QNX-API-EPOLL' && /epoll_create1/.test(f.match))!;
  assert.equal(ep.confidence, 'verified-absent');
  assert.equal(ep.severity, 'blocker');
  assert.match(ep.message, /verified on SDP 8\.0\.0/);
  const ino = r.findings.find((f) => f.ruleId === 'QNX-API-INOTIFY')!;
  assert.equal(ino.confidence, 'verified-present');
  assert.equal(ino.severity, 'info');
  assert.match(ino.remedy, /-lfsnotify/);
  const lrt = r.findings.find((f) => f.ruleId === 'QNX-BLD-LRT')!;
  assert.equal(lrt.confidence, 'verified-absent');
  assert.ok(r.stats.sdp!.verifiedPresentDropped >= 1);
  assert.ok(r.stats.findings < plain.stats.findings);
  const kept = scanDir(d, { sdp: m, sdpKeepPresent: true });
  assert.ok(kept.findings.some((f) => f.ruleId === 'QNX-API-SOCK-FLAGS' && f.severity === 'info'));
});

test('without a manifest nothing changes: no sdp field, confidence stays known|guess', () => {
  const d = proj({ 'a.c': 'int f(int e){ return epoll_create1(0); }\n' });
  const r = scanDir(d, {});
  assert.equal(r.stats.sdp, undefined);
  assert.ok(r.findings.every((f) => f.confidence === 'known' || f.confidence === 'guess'));
});
