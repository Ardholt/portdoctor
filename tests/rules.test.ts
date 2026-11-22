import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRules } from '../src/rules.ts';
import { scanText, scanDir } from '../src/scan.ts';
import type { Kind, RuleExample } from '../src/types.ts';

const FILE: Record<Kind, string> = { c: 't.c', cmake: 'CMakeLists.txt', make: 'Makefile', autoconf: 'configure.ac' };
const rules = loadRules();

function norm(e: string | RuleExample, def: Kind): RuleExample {
  return typeof e === 'string' ? { kind: def, text: e } : e;
}

function hits(rule: (typeof rules)[number], ex: RuleExample): number {
  if (ex.files) {
    const d = mkdtempSync(join(tmpdir(), 'pd-'));
    try {
      for (const [n, t] of Object.entries(ex.files)) {
        mkdirSync(dirname(join(d, n)), { recursive: true });
        writeFileSync(join(d, n), t);
      }
      return scanDir(d, { ruleIds: [rule.id] }).findings.filter((f) => f.ruleId === rule.id).length;
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
  const kind = ex.kind!;
  return scanText(FILE[kind], kind, ex.text!, [rule]).filter((f) => f.ruleId === rule.id).length;
}

test('rule set loads and is non-trivial', () => {
  assert.ok(rules.length >= 45, `only ${rules.length} rules`);
});

test('every guess rule carries a verify-against-SDP note', () => {
  for (const r of rules.filter((x) => x.confidence === 'guess')) assert.match(r.verify ?? '', /verify against SDP/i, r.id);
});

for (const rule of rules) {
  test(`${rule.id}: positive examples fire`, () => {
    rule.examples.positive.forEach((e, i) => assert.ok(hits(rule, norm(e, rule.appliesTo[0])) >= 1, `positive #${i} did not fire`));
  });
  test(`${rule.id}: negative examples stay quiet`, () => {
    rule.examples.negative.forEach((e, i) => assert.equal(hits(rule, norm(e, rule.appliesTo[0])), 0, `negative #${i} fired`));
  });
}
