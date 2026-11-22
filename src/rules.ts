import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompiledRule, Rule } from './types.ts';

export const DEFAULT_RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'rules');

const SEV = ['blocker', 'major', 'minor', 'info'];
const CONF = ['known', 'guess'];
const KINDS = ['c', 'cmake', 'make', 'autoconf'];
const SCOPES = ['code', 'string', 'include', 'any'];

export function validateRule(r: Rule, where: string): void {
  const bad = (m: string) => {
    throw new Error(`rule ${r?.id ?? '?'} (${where}): ${m}`);
  };
  if (!r.id || !/^QNX-[A-Z0-9-]+$/.test(r.id)) bad('id must match QNX-[A-Z0-9-]+');
  if (!SEV.includes(r.severity)) bad('bad severity');
  if (!CONF.includes(r.confidence)) bad('confidence must be known|guess');
  if (!Array.isArray(r.appliesTo) || !r.appliesTo.length || r.appliesTo.some((k) => !KINDS.includes(k))) bad('bad appliesTo');
  if (!SCOPES.includes(r.scope)) bad('bad scope');
  if (!r.pattern && !r.project) bad('needs pattern or project');
  if (!r.message || !r.remedy || !r.title) bad('title/message/remedy required');
  if (r.confidence === 'guess' && r.verify && !/verify against SDP/i.test(r.verify)) bad("verify must contain 'verify against SDP'");
  if (!r.examples || !r.examples.positive?.length || !r.examples.negative?.length) bad('needs positive and negative examples');
}

export function loadRules(dir: string = DEFAULT_RULES_DIR, only?: string[]): CompiledRule[] {
  const out: CompiledRule[] = [];
  const seen = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const arr = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Rule[];
    for (const r of arr) {
      validateRule(r, f);
      if (seen.has(r.id)) throw new Error(`duplicate rule id ${r.id}`);
      seen.add(r.id);
      if (only && only.length && !only.includes(r.id)) continue;
      const c: CompiledRule = { ...r };
      if (r.confidence === 'guess' && !r.verify) c.verify = 'verify against SDP.';
      if (r.pattern) c.re = new RegExp(r.pattern, 'gm' + (r.flags ?? '').replace(/[gm]/g, ''));
      out.push(c);
    }
  }
  return out;
}
