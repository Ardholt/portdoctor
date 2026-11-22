import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRules } from '../src/rules.ts';

const by = Object.fromEntries(loadRules().map((r) => [r.id, r]));
const txt = (id: string) => `${by[id].message} ${by[id].remedy} ${by[id].verify ?? ''}`;

test('socket/pipe flags are not called Linux extensions; they point at the SDP header and the BSD-derived stack', () => {
  for (const id of ['QNX-API-ACCEPT4', 'QNX-API-SOCK-FLAGS', 'QNX-API-PIPE2', 'QNX-API-MSG-NOSIGNAL', 'QNX-API-SOCKOPT-LINUX']) {
    assert.doesNotMatch(by[id].message, /is a Linux extension|are a Linux extension|Linux extensions/i, id);
    assert.match(txt(id), /io-sock/, id);
    assert.match(txt(id), /POSIX\.1-2017|SDP/, id);
  }
});

test('gettid is not mapped to pthread_self as an equivalent', () => {
  assert.match(by['QNX-API-SYSCALL'].remedy, /NOT a replacement for gettid/);
  assert.doesNotMatch(by['QNX-API-SYSCALL'].remedy, /gettid -> pthread_self/);
});

test('memfd remedy offers shm_open(SHM_ANON); epoll remedy offers kqueue and scopes ionotify; peercred names getpeereid', () => {
  assert.match(by['QNX-API-MEMFD'].remedy, /SHM_ANON/);
  assert.match(by['QNX-API-EPOLL'].remedy, /kqueue/);
  assert.match(by['QNX-API-EPOLL'].remedy, /only works for resource managers/);
  assert.match(by['QNX-API-PEERCRED'].remedy, /getpeereid/);
  assert.match(by['QNX-API-PEERCRED'].remedy, /does not apply to a socket/);
});

test('linux/* headers are a guess, not known', () => {
  assert.equal(by['QNX-HDR-LINUX-DIR'].confidence, 'guess');
});

test('every message that states an unverified QNX fact is marked guess or recalled', () => {
  for (const r of Object.values(by)) if (r.confidence === 'guess') assert.match(r.verify ?? '', /verify against SDP/i, r.id);
});
