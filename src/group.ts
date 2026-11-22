import type { Finding, ScanResult, Severity } from './types.ts';
import { SEVERITIES } from './types.ts';

type RuleInfo = ScanResult['rules'][number];

export interface Group {
  ruleId: string;
  title: string;
  category: string;
  severity: Severity;
  confidence: import('./types.ts').Confidence;
  rule?: RuleInfo;
  /** indices into ScanResult.findings */
  sites: number[];
  files: string[];
  /** every site is inside a Linux-only #if */
  allGuarded: boolean;
  /** rough minutes for the whole group (uncalibrated) */
  effortMin: number;
}

/**
 * Rough, UNCALIBRATED effort for one rule group: the rule's base minutes for the first site, 15% more per extra site
 * (Linux-only guarded sites count half), capped at 4x. Scaled by the number of finding groups rather than lines.
 */
export function groupEffort(base: number, sites: Finding[]): number {
  if (base <= 0) return 0;
  const n = sites.reduce((a, f) => a + (f.guard === 'linux-only' ? 0.5 : 1), 0);
  return base * Math.min(4, 1 + 0.15 * Math.max(0, n - 1));
}

const rank = (s: Severity) => SEVERITIES.indexOf(s);

export function groupFindings(res: Pick<ScanResult, 'findings' | 'rules'>): Group[] {
  const info = new Map(res.rules.map((r) => [r.id, r]));
  const by = new Map<string, number[]>();
  res.findings.forEach((f, i) => by.set(f.ruleId, [...(by.get(f.ruleId) ?? []), i]));
  const out: Group[] = [];
  for (const [id, idx] of by) {
    const fs = idx.map((i) => res.findings[i]);
    const rule = info.get(id);
    out.push({
      ruleId: id,
      title: fs[0].title,
      category: fs[0].category,
      severity: fs.reduce((a, f) => (rank(f.severity) < rank(a) ? f.severity : a), fs[0].severity),
      confidence: (fs.find((f) => f.severity === fs.reduce((a, g) => (rank(g.severity) < rank(a) ? g.severity : a), fs[0].severity)) ?? fs[0]).confidence,
      rule,
      sites: idx,
      files: [...new Set(fs.map((f) => f.file))],
      allGuarded: fs.every((f) => f.guard === 'linux-only'),
      effortMin: groupEffort(rule?.effort ?? fs[0].effort, fs),
    });
  }
  return out.sort((a, b) => rank(a.severity) - rank(b.severity) || b.effortMin - a.effortMin || (a.ruleId < b.ruleId ? -1 : 1));
}

/** Start-here ranking: groups with a not-Linux-guarded site first, then severity, then number of sites. Info is never suggested. */
export function startHere(groups: Group[], n = 3): Group[] {
  return groups
    .filter((g) => g.severity !== 'info' && g.effortMin > 0)
    .sort((a, b) => Number(a.allGuarded) - Number(b.allGuarded) || rank(a.severity) - rank(b.severity) || b.sites.length - a.sites.length || (a.ruleId < b.ruleId ? -1 : 1))
    .slice(0, n);
}

/** Rough range around an estimate: 0.5x to 1.5x. */
export function effortRange(min: number): [number, number] {
  return [min * 0.5, min * 1.5];
}

const PER: Record<string, number> = { min: 1, h: 60, 'person-days': 480 };

function pickUnit(min: number): string {
  return min < 60 ? 'min' : min < 16 * 60 ? 'h' : 'person-days';
}

function round(min: number, u: string): number {
  const v = min / PER[u];
  if (u === 'min') return Math.max(5, Math.round(v / 5) * 5);
  if (v < 3) return Math.round(v * 2) / 2;
  return Math.round(v);
}

/** "about 2-6 h (rough, uncalibrated)"; never a single figure, one unit for both ends. */
export function fmtRange(estimateMin: number, withCaveat = true): string {
  if (estimateMin <= 0) return 'no effort estimated';
  const [lo, hi] = effortRange(estimateMin);
  const cav = withCaveat ? ' (rough, uncalibrated)' : '';
  if (hi < 45) return `under an hour${cav}`;
  const u = pickUnit(hi);
  const a = round(lo, u);
  const b = round(hi, u);
  return a === b ? `about ${b} ${u}${cav}` : `about ${a}-${b} ${u}${cav}`;
}

export function totalEffort(groups: Group[]): number {
  return groups.reduce((a, g) => a + g.effortMin, 0);
}
