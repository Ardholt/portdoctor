#!/usr/bin/env node
// Deterministic stand-in for a model, for tests and the demo. It knows a fixed fix for four rules and declines the rest.
// Reads the request JSON on stdin and the project copy from $PD_ROOT; prints one patch-schema JSON object.
// STUB_MODE=break makes it emit a patch that does not compile (to show the check catching it).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  const req = JSON.parse(s);
  const f = req.finding;
  const FIX = {
    'QNX-API-PIPE2': (l) => l.replace('return pipe2(fds, O_CLOEXEC);', 'int r = pipe(fds);\n    if (r == 0) {\n        fcntl(fds[0], F_SETFD, FD_CLOEXEC);\n        fcntl(fds[1], F_SETFD, FD_CLOEXEC);\n    }\n    return r;'),
    'QNX-API-SOCK-FLAGS': (l) => l.replace('return socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);', 'int s = socket(AF_INET, SOCK_STREAM, 0);\n    if (s >= 0) fcntl(s, F_SETFL, O_NONBLOCK);\n    return s;'),
    'QNX-PATH-DEV-SHM': (l) => l.replace('return open("/dev/shm/demo", O_RDWR | O_CREAT, 0600);', 'return shm_open("/demo", O_RDWR | O_CREAT, 0600);'),
    'QNX-BLD-LRT': (l) => l.replace('LDLIBS = -lrt', 'LDLIBS ='),
  };
  const fix = FIX[f.ruleId];
  const out = (o) => process.stdout.write(JSON.stringify({ assumptions: [], confidence: 'low', needsHuman: true, ...o }));
  if (!fix) return out({ unifiedDiff: '', explanation: `stub has no fix for ${f.ruleId}`, needsHuman: true });
  const lines = readFileSync(join(process.env.PD_ROOT, f.file), 'utf8').split('\n');
  const old = lines[f.line - 1];
  let neu = fix(old);
  if (process.env.STUB_MODE === 'break') neu = neu + ' this is not C ;;;';
  if (neu === old) return out({ unifiedDiff: '', explanation: 'stub pattern did not match the line', needsHuman: true });
  const newLines = neu.split('\n');
  const a = Math.max(0, f.line - 1 - 3);
  const b = Math.min(lines.length, f.line + 3);
  const ctxB = lines.slice(a, f.line - 1);
  const ctxA = lines.slice(f.line, b);
  const hunk = [...ctxB.map((x) => ' ' + x), '-' + old, ...newLines.map((x) => '+' + x), ...ctxA.map((x) => ' ' + x)];
  const diff = `--- a/${f.file}\n+++ b/${f.file}\n@@ -${a + 1},${ctxB.length + 1 + ctxA.length} +${a + 1},${ctxB.length + newLines.length + ctxA.length} @@\n${hunk.join('\n')}\n`;
  out({ unifiedDiff: diff, explanation: `Deterministic stub fix for ${f.ruleId}.`, assumptions: ['stub: no QNX fact was checked'], verifyAgainstSdp: [], confidence: 'low', needsHuman: false });
});
