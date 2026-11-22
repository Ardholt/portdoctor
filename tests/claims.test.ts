import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRules } from '../src/rules.ts';

const by = Object.fromEntries(loadRules().map((r) => [r.id, r]));
const txt = (id: string) => `${by[id].message} ${by[id].remedy} ${by[id].verify ?? ''}`;

test('socket/pipe flags are not called Linux extensions; the text carries the SDP 8.0 evidence (PD3: measured, not recalled)', () => {
  for (const id of ['QNX-API-ACCEPT4', 'QNX-API-SOCK-FLAGS', 'QNX-API-PIPE2', 'QNX-API-MSG-NOSIGNAL', 'QNX-API-SOCKOPT-LINUX']) {
    assert.doesNotMatch(by[id].message, /is a Linux extension|are a Linux extension|Linux extensions\b(?! that originated)/i, id);
    assert.match(txt(id), /SDP 8\.0 build 141/, id);
  }
  assert.match(by['QNX-API-ACCEPT4'].message, /-lsocket/);
});

test('gettid is a native call on QNX and not mapped to pthread_self', () => {
  assert.match(by['QNX-API-SYSCALL'].remedy, /gettid\(\)/);
  assert.match(by['QNX-API-SYSCALL'].remedy, /<sys\/process\.h>/);
  assert.match(by['QNX-API-SYSCALL'].remedy, /Do not substitute pthread_self/);
});

test('epoll remedy no longer offers kqueue as a way out (not shipped to user code); inotify is present; memfd/peercred remedies named', () => {
  assert.doesNotMatch(by['QNX-API-EPOLL'].remedy, /Closest analogue to try/);
  assert.match(by['QNX-API-EPOLL'].message, /kqueue\/kevent are NOT a way out/);
  assert.match(by['QNX-API-EPOLL'].remedy, /only works for resource managers/);
  assert.match(by['QNX-API-INOTIFY'].message, /EXISTS on QNX 8\.0/);
  assert.match(by['QNX-API-INOTIFY'].remedy, /-lfsnotify/);
  assert.match(by['QNX-API-MEMFD'].remedy, /SHM_ANON/);
  assert.match(by['QNX-API-PEERCRED'].remedy, /getpeereid/);
  assert.match(by['QNX-API-PEERCRED'].remedy, /LOCAL_PEERCRED/);
});

test('linux/* headers: the SDP has no linux/ directory, stated as checked, still labelled guess for other SDP versions', () => {
  assert.equal(by['QNX-HDR-LINUX-DIR'].confidence, 'guess');
  assert.match(by['QNX-HDR-LINUX-DIR'].message, /ships no linux\//);
});

test('every guess rule says how it was checked or how to check it', () => {
  for (const r of Object.values(by)) if (r.confidence === 'guess') assert.match(r.verify ?? '', /verify against SDP|Verified|checked on SDP|SDP 8\.0 build 141|probes/i, r.id);
});

test('rules that carry sdp overrides use only absent|present|partial', () => {
  for (const r of Object.values(by)) for (const k of Object.keys(r.sdp ?? {})) assert.ok(['absent', 'present', 'partial'].includes(k), r.id);
});
