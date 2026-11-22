import { readFileSync } from 'node:fs';
import type { Finding } from './types.ts';

export type NameVerdict = 'declared-but-not-visible' | 'present' | 'present-gated' | 'absent' | 'absent-from-user-headers' | 'declared-not-linkable' | 'symbol-only' | 'declared-and-exported-but-probe-failed' | 'mixed';

interface ArchName { verdict: NameVerdict; declaredIn?: string[]; needsLib?: string; exportedBy?: string[]; firstError?: string; onlyInKernelPrivateHeaders?: boolean; usableWithGnuSource?: boolean; usableWithQnxExtensions?: boolean }
export interface SdpManifest {
  sdp: { product: string; build: string | null; gcc: string | null; qccTargets: string[] };
  names: Record<string, { kind: string; verdict: NameVerdict; x86_64?: ArchName; aarch64le?: ArchName }>;
  headers: Record<string, { verdict: 'present' | 'absent' | 'mixed' }>;
  libs: Record<string, { verdict: 'present' | 'absent' | 'mixed'; x86_64?: { fileInSdp: boolean; linksWithQcc: boolean }; aarch64le?: { fileInSdp: boolean; linksWithQcc: boolean } }>;
}

export interface SdpEvidence {
  verdict: 'present' | 'absent' | 'partial';
  items: Array<{ what: string; kind: 'name' | 'header' | 'lib'; result: string; evidence: string; needsLib?: string }>;
  build: string;
}

export function loadManifest(path: string): SdpManifest {
  const m = JSON.parse(readFileSync(path, 'utf8')) as SdpManifest;
  if (!m.names || !m.headers || !m.libs) throw new Error(`not an sdp manifest: ${path}`);
  return m;
}

const SKIP = new Set(['struct', 'union', 'enum', 'defined', 'include', 'sizeof', 'const', 'unsigned', 'int', 'long', 'char', 'void']);
const LIB_FOR_RULE: Record<string, string[]> = { 'QNX-BLD-LRT': ['rt'], 'QNX-BLD-LPTHREAD': ['pthread'], 'QNX-BLD-LDL': ['dl'] };
export const uncovered = new Set<string>();

function nameEvidence(n: string, e: SdpManifest['names'][string]): { absent: boolean; present: boolean; text: string; needsLib?: string } {
  const a = e.x86_64 ?? e.aarch64le!;
  const decl = (a.declaredIn ?? [])[0];
  const needsLib = a.needsLib && a.needsLib !== '-lsocket -lm' ? a.needsLib : a.needsLib ? '-lsocket' : undefined;
  switch (e.verdict) {
    case 'present': return { absent: false, present: true, needsLib, text: `${n}: present on both targets (declared ${decl ?? '?'}${needsLib ? `; links only with ${needsLib}` : ''})` };
    case 'present-gated': return { absent: false, present: true, text: `${n}: usable only with feature macros (_GNU_SOURCE/_QNX_SOURCE)` };
    case 'absent': return { absent: true, present: false, text: `${n}: not declared in any user header of the SDP and not exported by any SDP library; probe: ${(a.firstError ?? '').replace(/^.*?error: /, '').slice(0, 80)}` };
    case 'absent-from-user-headers': return { absent: true, present: false, text: `${n}: found only in io-sock kernel/driver headers (devs/), not in any user-facing header; compile probe fails` };
    case 'declared-but-not-visible': return { absent: true, present: false, text: `${n}: the name appears in SDP headers (${decl ?? '?'}) but is commented out, guarded off or is a different thing (struct/macro); the compile probe cannot see it` };
    case 'declared-not-linkable': return { absent: true, present: false, text: `${n}: declared (${decl ?? '?'}) but link fails with the default libraries, -lsocket and -lm: no SDP library exports it` };
    case 'symbol-only': return { absent: true, present: false, text: `${n}: exported by ${(a.exportedBy ?? []).join(',')} but undeclared in the standard headers` };
    default: return { absent: false, present: false, text: `${n}: ${e.verdict}` };
  }
}

/** look up what a finding is about in the manifest; null = the manifest cannot say */
export function classify(f: Pick<Finding, 'ruleId' | 'match'>, m: SdpManifest): SdpEvidence | null {
  const items: SdpEvidence['items'] = [];
  let absent = 0, present = 0;
  const build = m.sdp.build ?? 'unknown build';
  const hdr = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(f.match);
  if (hdr) {
    const h = m.headers[hdr[1]];
    if (!h) { uncovered.add('header ' + hdr[1]); return null; }
    items.push({ what: hdr[1], kind: 'header', result: h.verdict, evidence: `<${hdr[1]}> ${h.verdict === 'present' ? 'compiles' : 'not found / does not compile'} with qcc on x86_64 and aarch64le` });
    return { verdict: h.verdict === 'present' ? 'present' : h.verdict === 'absent' ? 'absent' : 'partial', items, build };
  }
  const libs = [...f.match.matchAll(/-l([\w+]+)/g)].map((x) => x[1]);
  if (!libs.length && LIB_FOR_RULE[f.ruleId]) libs.push(...LIB_FOR_RULE[f.ruleId]);
  if (f.ruleId === 'QNX-BLD-LNSL' && !libs.length) libs.push('nsl');
  if (libs.length || /^QNX-BLD-L/.test(f.ruleId)) {
    for (const l of libs) {
      const e = m.libs[l];
      if (!e) { uncovered.add('lib ' + l); continue; }
      const ok = e.verdict === 'present';
      items.push({ what: '-l' + l, kind: 'lib', result: e.verdict, evidence: `-l${l}: ${ok ? 'links with qcc' : 'ld: cannot find -l' + l}${e.x86_64?.fileInSdp ? '' : ' (no lib' + l + '.so/.a in the SDP)'}` });
      if (ok) present++; else absent++;
    }
    if (!items.length) return null;
    return { verdict: present && absent ? 'partial' : present ? 'present' : 'absent', items, build };
  }
  if (!/^QNX-(API|ADV-FUSE)/.test(f.ruleId)) return null;
  for (const id of new Set(f.match.match(/[A-Za-z_]\w*/g) ?? [])) {
    if (SKIP.has(id)) continue;
    const e = m.names[id];
    if (!e) { uncovered.add('name ' + id); continue; }
    const ev = nameEvidence(id, e);
    items.push({ what: id, kind: 'name', result: e.verdict, evidence: ev.text, needsLib: ev.needsLib });
    if (ev.absent) absent++; else if (ev.present) present++;
  }
  if (!items.length) return null;
  return { verdict: present && absent ? 'partial' : present ? 'present' : absent ? 'absent' : 'partial', items, build };
}

