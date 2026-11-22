import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { scanDir } from '../src/scan.ts';

function mk(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'pd-b-'));
  for (const [n, t] of Object.entries(files)) {
    mkdirSync(dirname(join(d, n)), { recursive: true });
    writeFileSync(join(d, n), t);
  }
  return d;
}
const EPOLL = 'int f(void){ return epoll_create1(0); }\n';
const built = (r: ReturnType<typeof scanDir>, file: string) => r.findings.filter((f) => f.file === file).map((f) => f.built);

test('CMake source list: a file the list does not name is flagged "not in build list" (heuristic); named files are not', () => {
  const d = mk({ 'CMakeLists.txt': 'add_executable(app src/a.c)\n', 'src/a.c': EPOLL, 'src/old_linux.c': EPOLL });
  try {
    const r = scanDir(d);
    assert.equal(r.stats.build.source, 'build files');
    assert.deepEqual(built(r, 'src/a.c'), [undefined]);
    assert.deepEqual(built(r, 'src/old_linux.c'), ['no']);
    assert.equal(r.stats.build.findingsNotInBuildList, 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('Makefile object lists and sub-directory build files resolve relative to their directory', () => {
  const d = mk({ 'Makefile': 'OBJS = main.o\n', 'main.c': EPOLL, 'other.c': EPOLL });
  try {
    const r = scanDir(d);
    assert.deepEqual(built(r, 'main.c'), [undefined]);
    assert.deepEqual(built(r, 'other.c'), ['no']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('compile_commands.json is preferred; paths outside the root are ignored', () => {
  const d = mk({ 'a.c': EPOLL, 'b.c': EPOLL, 'CMakeLists.txt': 'add_executable(x a.c b.c)\n' });
  try {
    writeFileSync(join(d, 'compile_commands.json'), JSON.stringify([{ directory: d, file: 'a.c', command: 'cc a.c' }, { directory: '/elsewhere', file: '/elsewhere/z.c', command: 'cc' }]));
    const r = scanDir(d);
    assert.equal(r.stats.build.source, 'compile_commands.json');
    assert.deepEqual(built(r, 'a.c'), [undefined]);
    assert.deepEqual(built(r, 'b.c'), ['no']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('globs/wildcards disable marking (the list is not knowable); --no-build-awareness disables it too', () => {
  const d = mk({ 'CMakeLists.txt': 'file(GLOB SRCS *.c)\nadd_executable(app a.c)\n', 'a.c': EPOLL, 'b.c': EPOLL });
  const e = mk({ 'CMakeLists.txt': 'add_executable(app a.c)\n', 'a.c': EPOLL, 'b.c': EPOLL });
  try {
    const r = scanDir(d);
    assert.equal(r.stats.build.source, 'none');
    assert.equal(r.stats.build.findingsNotInBuildList, 0);
    assert.equal(scanDir(e, { buildAwareness: false }).stats.build.findingsNotInBuildList, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(e, { recursive: true, force: true });
  }
});

test('headers are never flagged as not built', () => {
  const d = mk({ 'CMakeLists.txt': 'add_executable(app a.c)\n', 'a.c': 'int x;\n', 'x.h': '#include <sys/epoll.h>\n' });
  try {
    assert.deepEqual(built(scanDir(d), 'x.h'), [undefined]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('--ignore-preset other-os skips other-OS paths, keeps linux and generic ones; unknown preset is an error', () => {
  const d = mk({ 'src/unix/os390-syscalls.c': EPOLL, 'src/unix/freebsd.c': EPOLL, 'src/win/pipe.c': EPOLL, 'src/unix/darwin.c': EPOLL, 'src/unix/linux.c': EPOLL, 'src/core.c': EPOLL, 'src/pineapple.c': EPOLL });
  try {
    const all = new Set(scanDir(d, { buildAwareness: false }).findings.map((f) => f.file));
    assert.equal(all.size, 7);
    const kept = new Set(scanDir(d, { ignorePresets: ['other-os'], buildAwareness: false }).findings.map((f) => f.file));
    assert.deepEqual([...kept].sort(), ['src/core.c', 'src/pineapple.c', 'src/unix/linux.c']);
    assert.throws(() => scanDir(d, { ignorePresets: ['nope'] }), /unknown ignore preset/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
