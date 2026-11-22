import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { scanDir } from '../src/scan.ts';
import { renderHtml } from '../src/report-html.ts';

// Real browser test: headless Chrome driven over the DevTools protocol with real mouse events.
// Skipped when no Chrome is installed (set PD_CHROME to a binary to override).
const CHROME = [process.env.PD_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p));

let dir = '';
let chrome: ChildProcess | null = null;
let ws: WebSocket;
let session = '';
let nextId = 1;
const pending = new Map<number, (m: any) => void>();

function send(method: string, params: object = {}, sid?: string): Promise<any> {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
  });
}
async function ev(expr: string): Promise<any> {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, session);
  if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function click(selector: string): Promise<void> {
  const box = await ev(`(()=>{var e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});var r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y }, session);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 }, session);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 }, session);
}

before(async () => {
  if (!CHROME) return;
  dir = mkdtempSync(join(tmpdir(), 'pd-chrome-'));
  const proj = join(dir, 'proj');
  const files: Record<string, string> = {
    'alpha/a.c': 'int a(void){ return epoll_create1(0); }\nint b(void){ return epoll_wait(0,0,0,0); }\n',
    'beta/b.c': 'int a(void){ return inotify_init(); }\n',
    'gamma/c.c': 'int a(void){ return eventfd(0,0); }\n',
    'delta/d.c': 'int a(void){ return prctl(1,2); }\n',
  };
  for (const [n, t] of Object.entries(files)) {
    mkdirSync(join(proj, n, '..'), { recursive: true });
    writeFileSync(join(proj, n), t);
  }
  writeFileSync(join(dir, 'report.html'), renderHtml(scanDir(proj)));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(dir, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url: string = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('chrome did not start: ' + buf)), 15000);
    chrome!.stderr!.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(t);
        res(m[1]);
      }
    });
  });
  ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.onopen = () => res(null);
    ws.onerror = () => rej(new Error('ws error'));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
    }
  };
  const { targetId } = await send('Target.createTarget', { url: 'file://' + join(dir, 'report.html') });
  session = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, session);
  for (let i = 0; i < 50 && (await ev('document.readyState')) !== 'complete'; i++) await new Promise((r) => setTimeout(r, 100));
});

after(() => {
  try {
    ws?.close();
  } catch {}
  chrome?.kill('SIGKILL');
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const opts = { skip: CHROME ? false : 'no Chrome binary found' };

test('chrome: a real click on a heat-map tile filters the findings, a second click clears', opts, async () => {
  assert.equal(await ev(`document.querySelector('#count').textContent`), '5 of 5 findings shown');
  assert.equal(await ev(`document.querySelectorAll('.tile').length`), 4);
  await click('.tile[data-dir="alpha"]');
  assert.equal(await ev(`document.querySelector('#count').textContent`), '2 of 5 findings shown');
  assert.equal(await ev(`document.querySelector('.tile[data-dir="alpha"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await ev(`document.querySelectorAll('details.grp:not([hidden])').length`), 1);
  await click('.tile[data-dir="alpha"]');
  assert.equal(await ev(`document.querySelector('#count').textContent`), '5 of 5 findings shown');
  await click('.tile[data-dir="gamma"]');
  assert.equal(await ev(`document.querySelector('#count').textContent`), '1 of 5 findings shown');
});

test('chrome: absolute-scale toggle changes tile colour intensity', opts, async () => {
  const before = await ev(`document.querySelector('.tile[data-dir="alpha"]').style.getPropertyValue('--i')`);
  await click('#scale');
  assert.equal(await ev(`document.querySelector('#scale').getAttribute('aria-pressed')`), 'true');
  const after = await ev(`document.querySelector('.tile[data-dir="alpha"]').style.getPropertyValue('--i')`);
  assert.notEqual(before, after);
  await click('#scale');
  assert.equal(await ev(`document.querySelector('.tile[data-dir="alpha"]').style.getPropertyValue('--i')`), before);
});

test('chrome: rule groups expand on click and Expand all works; disclaimer details toggles', opts, async () => {
  await click('#clear');
  assert.equal(await ev(`document.querySelectorAll('details.grp[open]').length`), 0);
  await click('details.grp > summary');
  assert.equal(await ev(`document.querySelectorAll('details.grp[open]').length`), 1);
  await click('#expand');
  assert.equal(await ev(`document.querySelectorAll('details.grp:not([open])').length`), 0);
  assert.equal(await ev(`document.querySelector('details.banner').open`), false);
  await click('details.banner > summary');
  assert.equal(await ev(`document.querySelector('details.banner').open`), true);
});

test('chrome: start-here panel lists at most 3 groups and links to a rule group', opts, async () => {
  const n = await ev(`document.querySelectorAll('ol.start li').length`);
  assert.ok(n >= 1 && n <= 3, 'start items ' + n);
  assert.equal(await ev(`document.querySelector('ol.start a.t').getAttribute('href').startsWith('#rule-QNX-')`), true);
  assert.equal(await ev(`document.documentElement.scrollWidth <= window.innerWidth`), true);
});
