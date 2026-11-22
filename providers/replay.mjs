#!/usr/bin/env node
// PortDoctor provider: replays responses recorded by providers/record.sh (JSONL: ruleId, file, line, response).
// Use it where the model CLI cannot run (for example inside the network-less SDP sandbox): patches were produced elsewhere, by a real model,
// from the same request, and are replayed here byte for byte. Each recorded response is used once, matched on ruleId + file.
// usage: --provider "node providers/replay.mjs patches.jsonl"
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const file = process.argv[2];
const used = (process.env.PD_REPLAY_STATE ?? file + '.used');
let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  const req = JSON.parse(s);
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const done = new Set(existsSync(used) ? readFileSync(used, 'utf8').split('\n').filter(Boolean).map(Number) : []);
  const i = rows.findIndex((r, k) => !done.has(k) && r.ruleId === req.finding.ruleId && r.file === req.finding.file);
  if (i < 0) { console.error(`replay: no recorded response for ${req.finding.ruleId} ${req.finding.file}`); process.exit(3); }
  done.add(i);
  writeFileSync(used, [...done].join('\n') + '\n');
  process.stdout.write(rows[i].response);
});
