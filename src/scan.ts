import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep, basename, resolve } from 'node:path';
import { loadRules } from './rules.ts';
import { groupFindings, totalEffort } from './group.ts';
import { collectBuildInfo, isTranslationUnit } from './build.ts';
import { classify as sdpClassify, uncovered } from './sdp.ts';
import type { CompiledRule, Finding, Kind, ScanOptions, ScanResult, Severity, ContextLine } from './types.ts';

export const VERSION = '0.3.0';

/** Opt-in ignore presets. `other-os` is a path-name heuristic for sources written for other operating systems; it never runs unless asked. */
export const IGNORE_PRESETS: Record<string, string[]> = {
  'other-os': ['(^|[/._-])(os390|mingw\\d*|win32|win64|windows|msvc|cygwin|darwin|macos|freebsd|openbsd|netbsd|dragonfly|solaris|sunos|aix|haiku|android|ios)([/._-]|$)', '(^|/)win(/|$)'],
};
export const DISCLAIMER =
  'PortDoctor is a static, text-level scanner. Nothing here was compiled or run against a QNX SDP. ' +
  "Rules marked 'guess' are unverified claims about QNX 8.0 and must be checked against the SDP.";

const SKIP_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', 'CMakeFiles', '.idea', '.vscode']);
const C_EXT = new Set(['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.c++', '.h++', '.inl', '.ipp']);

export function detectKind(name: string): Kind | null {
  const b = name.toLowerCase();
  if (b === 'cmakelists.txt' || b.endsWith('.cmake') || b.endsWith('.cmake.in')) return 'cmake';
  if (b === 'configure.ac' || b === 'configure.in' || b === 'acinclude.m4') return 'autoconf';
  if (/^(gnu)?makefile(\.[a-z0-9_-]+)?$/.test(b) && !b.endsWith('.in')) return 'make';
  if (b.endsWith('.mk') || b === 'makefile.am') return 'make';
  const dot = b.lastIndexOf('.');
  if (dot >= 0 && C_EXT.has(b.slice(dot))) return 'c';
  return null;
}

/** Blank out comments (and optionally string/char literal bodies) keeping offsets and newlines. */
export function maskC(text: string): { noComment: string; code: string } {
  const n = text.length;
  const a = text.split('');
  const c = text.split('');
  const blank = (arr: string[], i: number) => {
    if (arr[i] !== '\n') arr[i] = ' ';
  };
  let i = 0;
  while (i < n) {
    const ch = text[i];
    const nx = text[i + 1];
    if (ch === '/' && nx === '/') {
      while (i < n && !(text[i] === '\n' && text[i - 1] !== '\\')) {
        blank(a, i);
        blank(c, i);
        i++;
      }
    } else if (ch === '/' && nx === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (; i < stop; i++) {
        blank(a, i);
        blank(c, i);
      }
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n && text[j] !== '\n') {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === ch) {
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) {
        i++;
        continue;
      }
      for (let k = i + 1; k < j; k++) blank(c, k);
      i = j + 1;
    } else i++;
  }
  return { noComment: a.join(''), code: c.join('') };
}

export function maskScript(text: string, kind: Kind): string {
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    let q = '';
    let cut = -1;
    for (let k = 0; k < l.length; k++) {
      const ch = l[k];
      if (q) {
        if (ch === '\\') k++;
        else if (ch === q) q = '';
      } else if (ch === '"') q = ch;
      else if (ch === '#' && l[k - 1] !== '\\' && l[k - 1] !== '$') {
        cut = k;
        break;
      } else if (kind === 'autoconf' && ch === 'd' && l.startsWith('dnl', k) && (k === 0 || /[\s;]/.test(l[k - 1]))) {
        cut = k;
        break;
      }
    }
    if (cut >= 0) lines[li] = l.slice(0, cut) + ' '.repeat(l.length - cut);
  }
  return lines.join('\n');
}

const COND_LINE = /^[ \t]*#[ \t]*(?:if|ifdef|ifndef|elif)\b/;

type Cls = 'linux' | 'notlinux' | 'qnx' | 'notqnx' | 'other' | 'plain';
interface Frame {
  cls: Cls;
  text: string;
}

function classify(directive: string, expr: string): Cls {
  const lin = /\b(?:__linux__|__linux|__gnu_linux__)\b/.test(expr);
  const qnx = /\b(?:__QNX__|__QNXNTO__)\b/.test(expr);
  if (lin && qnx) return 'other';
  if (!lin && !qnx) return 'plain';
  const neg = directive === 'ifndef' || /!\s*(?:defined\s*\(?\s*)?(?:__linux__|__linux|__gnu_linux__|__QNX__|__QNXNTO__)/.test(expr);
  if (/\|\||\bor\b/.test(expr)) return 'other';
  if (lin) return neg ? 'notlinux' : 'linux';
  return neg ? 'notqnx' : 'qnx';
}

const FLIP: Record<Cls, Cls> = { linux: 'notlinux', notlinux: 'linux', qnx: 'notqnx', notqnx: 'qnx', other: 'other', plain: 'plain' };

/** For each line (0-based) the stack of conditional frames in effect when the line is reached. */
export function conditionalFrames(noComment: string): Frame[][] {
  const lines = noComment.split('\n');
  const stack: Frame[] = [];
  const out: Frame[][] = [];
  for (const l of lines) {
    out.push(stack.slice());
    const m = /^[ \t]*#[ \t]*(ifdef|ifndef|if|elif|else|endif)\b(.*)$/.exec(l);
    if (!m) continue;
    const [, d, rest] = m;
    const text = `#${d}${rest.trim() ? ' ' + rest.trim() : ''}`;
    if (d === 'if' || d === 'ifdef' || d === 'ifndef') stack.push({ cls: classify(d, rest), text });
    else if (d === 'elif') {
      if (stack.length) stack[stack.length - 1] = { cls: classify('if', rest), text };
    } else if (d === 'else') {
      if (stack.length) {
        const top = stack[stack.length - 1];
        stack[stack.length - 1] = { cls: FLIP[top.cls], text: top.text + ' (#else)' };
      }
    } else if (d === 'endif') stack.pop();
  }
  return out;
}


const KEYWORDS = new Set(['return', 'else', 'do', 'case', 'goto', 'sizeof', 'throw', 'new', 'delete', 'typeof', 'defined', 'and', 'or', 'not', 'if', 'while', 'for', 'switch']);

function prevTok(s: string, i: number): { t: string; at: number } {
  let j = i - 1;
  while (j >= 0 && /\s/.test(s[j])) j--;
  if (j < 0) return { t: '', at: -1 };
  if (/\w/.test(s[j])) {
    let k = j;
    while (k > 0 && /\w/.test(s[k - 1])) k--;
    return { t: s.slice(k, j + 1), at: k };
  }
  return { t: s[j], at: j };
}

/**
 * Syntactic sensor, not a judge: is the identifier at `i` a plain function call, or is it a member call
 * (x->f(), x.f(), Cls::f()), or a declaration/definition of a function with that name (type before the name)?
 */
export function isPlainCall(code: string, i: number): boolean {
  const p = prevTok(code, i);
  if (p.t === '.') return false;
  if (p.t === '>' && code[p.at - 1] === '-') return false;
  if (p.t === ':' && code[p.at - 1] === ':') {
    const q = prevTok(code, p.at - 1);
    return !(/^\w/.test(q.t) || q.t === '>');
  }
  if (/^[A-Za-z_]\w*$/.test(p.t)) return KEYWORDS.has(p.t);
  if (p.t === '*' || p.t === '&') {
    const q = prevTok(code, p.at);
    if (/^[A-Za-z_]\w*$/.test(q.t) && !KEYWORDS.has(q.t)) return false;
  }
  return true;
}

/**
 * Names this text declares as functions (a type or `define` precedes the name). With bodyOnly, only those
 * followed by a `{ body }`: a bare prototype may just re-declare a libc function (libev's signalfd shim does).
 */
export function declaredNames(code: string, bodyOnly = false): Set<string> {
  const out = new Set<string>();
  const re = /\b([A-Za-z_]\w*)[ \t]*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (KEYWORDS.has(m[1]) || isPlainCall(code, m.index)) continue;
    const p = prevTok(code, m.index);
    if (p.t === '.' || p.t === '>' || p.t === ':') continue;
    if (bodyOnly) {
      let d = 1;
      let j = m.index + m[0].length;
      while (j < code.length && d > 0) {
        if (code[j] === '(') d++;
        else if (code[j] === ')') d--;
        j++;
      }
      const rest = /^\s*(?:const\b\s*|noexcept\b\s*|override\b\s*|__attribute__\s*\(\([^)]*\)\)\s*)*\{/.test(code.slice(j, j + 120));
      if (!rest) continue;
    }
    out.add(m[1]);
  }
  return out;
}

const CALL_RE = /^([A-Za-z_]\w*)\s*\($/;
const IDENT_RE = /^(?:struct\s+)?([A-Za-z_]\w*)/;

function walk(root: string, rel: string, out: string[], skipped: { n: number }, ignore: RegExp[]): void {
  let ents;
  try {
    ents = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    skipped.n++;
    return;
  }
  ents.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  for (const e of ents) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !ignore.some((x) => x.test(r + '/'))) walk(root, r, out, skipped, ignore);
    } else if (e.isFile() && detectKind(e.name) && !ignore.some((x) => x.test(r))) out.push(r);
  }
}

export function scanText(
  relFile: string,
  kind: Kind,
  text: string,
  rules: CompiledRule[],
  contextLines = 3,
  counters: { suppressed: number; nonCall?: number } = { suppressed: 0 },
  seenRuleFile = new Set<string>(),
  userFns?: Set<string>,
): Finding[] {
  const raw = text.replace(/\r\n?/g, '\n');
  const rawLines = raw.split('\n');
  let noComment: string;
  let code: string;
  let frames: Frame[][] | null = null;
  if (kind === 'c') {
    const m = maskC(raw);
    noComment = m.noComment;
    code = m.code;
    frames = conditionalFrames(noComment);
  } else {
    noComment = code = maskScript(raw, kind);
  }
  const lineStarts: number[] = [0];
  for (let i = 0; i < raw.length; i++) if (raw[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (off: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const findings: Finding[] = [];
  const fileFns = kind === 'c' ? declaredNames(code, true) : null;
  for (const r of rules) {
    if (!r.re || !r.appliesTo.includes(kind)) continue;
    const hay = r.scope === 'code' ? code : noComment;
    const re = new RegExp(r.re.source, r.re.flags);
    const seenLines = new Set<number>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay))) {
      if (m[0] === '') {
        re.lastIndex++;
        continue;
      }
      if (r.scope === 'string' && code[m.index] === noComment[m.index]) continue;
      const li = lineOf(m.index);
      if (r.scope === 'code' && kind === 'c') {
        let j = li;
        while (j > 0 && rawLines[j - 1].trimEnd().endsWith('\\')) j--;
        if (COND_LINE.test(rawLines[j])) continue;
        const def = /^[ \t]*#[ \t]*define[ \t]+/.exec(rawLines[j]);
        if (def && j === li && m.index - lineStarts[li] === def[0].length) continue;
      }
      if (kind === 'c' && r.scope === 'code') {
        const id = IDENT_RE.exec(m[0])?.[1];
        const ev = id && r.evidence?.[id];
        const skip =
          (ev && !new RegExp(ev).test(noComment)) ||
          (CALL_RE.test(m[0]) && id && (!isPlainCall(code, m.index) || fileFns!.has(id) || userFns?.has(id)));
        if (skip) {
          counters.nonCall = (counters.nonCall ?? 0) + 1;
          continue;
        }
      }
      if (seenLines.has(li)) continue;
      seenLines.add(li);
      let guard: Finding['guard'] = 'none';
      const guards: string[] = [];
      if (frames) {
        const fs = frames[li] ?? [];
        if (fs.some((f) => f.cls === 'qnx' || f.cls === 'notqnx')) {
          counters.suppressed++;
          continue;
        }
        for (const f of fs) guards.push(f.text);
        if (fs.some((f) => f.cls === 'linux')) guard = 'linux-only';
        else if (fs.length) guard = 'other';
      }
      const key = r.id + '\0' + relFile;
      const repeat = seenRuleFile.has(key);
      seenRuleFile.add(key);
      let effort = r.effort * (repeat ? 0.3 : 1) * (guard === 'linux-only' ? 0.5 : 1);
      if (r.effort > 0) effort = Math.max(1, Math.round(effort));
      const ctx: ContextLine[] = [];
      for (let k = Math.max(0, li - contextLines); k <= Math.min(rawLines.length - 1, li + contextLines); k++) {
        ctx.push({ n: k + 1, text: rawLines[k].slice(0, 400) });
      }
      findings.push({
        ruleId: r.id,
        title: r.title,
        category: r.category,
        severity: r.severity,
        confidence: r.confidence,
        file: relFile,
        line: li + 1,
        column: m.index - lineStarts[li] + 1,
        match: m[0].trim().slice(0, 120),
        context: ctx,
        message: r.message,
        remedy: r.remedy,
        verify: r.verify,
        effort,
        guard,
        guards,
      });
    }
  }
  return findings;
}

const SEV_ORDER: Record<Severity, number> = { blocker: 0, major: 1, minor: 2, info: 3 };

export function scanDir(root: string, opts: ScanOptions = {}): ScanResult {
  const rules = loadRules(opts.rulesDir, opts.ruleIds);
  const maxBytes = opts.maxFileBytes ?? 2_000_000;
  const files: string[] = [];
  const skipped = { n: 0 };
  const ign = [...(opts.ignore ?? [])];
  for (const p of opts.ignorePresets ?? []) {
    if (!IGNORE_PRESETS[p]) throw new Error(`unknown ignore preset '${p}' (known: ${Object.keys(IGNORE_PRESETS).join(', ')})`);
    ign.push(...IGNORE_PRESETS[p]);
  }
  walk(root, '', files, skipped, ign.map((x) => new RegExp(x)));
  const findings: Finding[] = [];
  const counters: { suppressed: number; nonCall: number } = { suppressed: 0, nonCall: 0 };
  const seenRuleFile = new Set<string>();
  const byKind: Record<string, string[]> = { c: [], cmake: [], make: [], autoconf: [] };
  const projRules = rules.filter((r) => r.project);
  const mentions = new Map<string, boolean>();
  const absentRes = new Map<string, RegExp>();
  for (const r of projRules) absentRes.set(r.id, new RegExp(r.project!.absent));
  const codeRes = new Map<string, RegExp>();
  for (const r of projRules) if (r.project!.requireCode) codeRes.set(r.id, new RegExp(r.project!.requireCode, 'm'));
  const codeUses = new Set<string>();
  let scanned = 0;
  const kindCount: Record<string, number> = {};
  const loaded: Array<{ rel: string; kind: Kind; text: string }> = [];
  const projectDefined = new Set<string>();
  const declaredIn = new Map<string, Set<string>>();
  for (const rel of files) {
    const abs = join(root, rel.split('/').join(sep));
    const kind = detectKind(basename(rel))!;
    let text: string;
    try {
      if (statSync(abs).size > maxBytes) {
        skipped.n++;
        continue;
      }
      const buf = readFileSync(abs);
      if (buf.includes(0)) {
        skipped.n++;
        continue;
      }
      text = buf.toString('utf8');
    } catch {
      skipped.n++;
      continue;
    }
    loaded.push({ rel, kind, text });
    if (kind === 'c') {
      const code = maskC(text.replace(/\r\n?/g, '\n')).code;
      declaredIn.set(rel, declaredNames(code));
      for (const [id, re] of codeRes) if (!codeUses.has(id) && re.test(code)) codeUses.add(id);
      for (const n of declaredNames(code, true)) projectDefined.add(n);
    }
  }
  const userFnsFor = (rel: string, text: string): Set<string> => {
    const out = new Set<string>();
    for (const m of text.matchAll(/^[ \t]*#[ \t]*include[ \t]*"([^"\n]+)"/gm)) {
      for (const [other, names] of declaredIn) {
        if (other === m[1] || other.endsWith('/' + m[1].replace(/^\.\//, ''))) for (const n of names) if (projectDefined.has(n)) out.add(n);
      }
    }
    return out;
  };
  for (const { rel, kind, text } of loaded) {
    scanned++;
    kindCount[kind] = (kindCount[kind] ?? 0) + 1;
    byKind[kind].push(rel);
    for (const r of projRules) if (!mentions.get(r.id) && absentRes.get(r.id)!.test(text)) mentions.set(r.id, true);
    findings.push(...scanText(rel, kind, text, rules, opts.contextLines ?? 3, counters, seenRuleFile, kind === 'c' ? userFnsFor(rel, text) : undefined));
  }
  for (const r of projRules) {
    const list = byKind[r.project!.requireKind];
    const target = [r.project!.reportOnKind, ...(r.project!.reportFallback ?? [])].map((k) => byKind[k]).find((t) => t.length) ?? [];
    if (!list.length || !target.length || mentions.get(r.id)) continue;
    if (codeRes.has(r.id) && !codeUses.has(r.id)) continue;
    const first = target.slice().sort((x, y) => x.split('/').length - y.split('/').length || (x < y ? -1 : 1))[0];
    findings.push({
      ruleId: r.id, title: r.title, category: r.category, severity: r.severity, confidence: r.confidence,
      file: first, line: 1, column: 1, match: '(project-level)', context: [], message: r.message,
      remedy: r.remedy, verify: r.verify, effort: r.effort, guard: 'none', guards: [],
    });
  }
  const build = opts.buildAwareness === false ? { source: 'none' as const, compiled: null, note: 'disabled' } : collectBuildInfo(root, loaded);
  let marked = 0;
  if (build.compiled) {
    for (const f of findings) {
      if (isTranslationUnit(f.file) && !build.compiled.has(f.file)) {
        f.built = 'no';
        marked++;
      }
    }
  }
  let sdpStats: ScanResult['stats']['sdp'];
  if (opts.sdp) {
    const m = opts.sdp;
    const byId = new Map(rules.map((r) => [r.id, r]));
    const st = { build: m.sdp.build, classified: 0, verifiedAbsent: 0, verifiedPartial: 0, verifiedPresentKept: 0, verifiedPresentDropped: 0, notCovered: 0, droppedByRule: {} as Record<string, string[]>, uncovered: [] as string[] };
    uncovered.clear();
    const kept: Finding[] = [];
    for (const f of findings) {
      const rule = byId.get(f.ruleId);
      const ev = f.match === '(project-level)' ? null : sdpClassify(f, m);
      if (!ev || !rule) {
        if (f.match !== '(project-level)' && /^QNX-(API|HDR|BLD-L(RT|PTHREAD|DL|NSL)|BLD-(PIE|FPIC|SANITIZE|MARCH-NATIVE)|ADV-FUSE)/.test(f.ruleId)) st.notCovered++;
        kept.push(f);
        continue;
      }
      st.classified++;
      const ov = rule.sdp?.[ev.verdict];
      const libs = [...new Set(ev.items.map((i) => i.needsLib).filter(Boolean))].join(' ');
      const evText = ev.items.map((i) => i.evidence).join('; ');
      f.sdp = ev;
      f.confidence = ('verified-' + ev.verdict) as Finding['confidence'];
      f.message = `${ov?.message ?? f.message} [verified on SDP ${m.sdp.build ?? ''} by compile/link probe, not run on target: ${evText}]`;
      if (ov?.remedy) f.remedy = ov.remedy;
      f.verify = 'checked against the installed SDP (header, symbol and qcc probes); not executed on a QNX target.';
      if (ev.verdict === 'present') {
        if (!ov?.keep && !libs && !opts.sdpKeepPresent) {
          st.verifiedPresentDropped++;
          (st.droppedByRule[f.ruleId] ??= []).push(...ev.items.map((i) => i.what));
          continue;
        }
        f.severity = ov?.severity ?? 'info';
        f.effort = libs ? 3 : 2;
        if (libs) f.remedy = `${f.remedy} The SDP has it, but it needs ${libs} on the link line.`;
        st.verifiedPresentKept++;
      } else if (ev.verdict === 'absent') {
        if (ov?.severity) f.severity = ov.severity;
        st.verifiedAbsent++;
      } else {
        if (ov?.severity) f.severity = ov.severity;
        st.verifiedPartial++;
      }
      kept.push(f);
    }
    for (const k of Object.keys(st.droppedByRule)) st.droppedByRule[k] = [...new Set(st.droppedByRule[k])].sort();
    st.uncovered = [...uncovered].sort();
    findings.length = 0;
    findings.push(...kept);
    sdpStats = st;
  }
  findings.sort(
    (a, b) =>
      SEV_ORDER[a.severity] - SEV_ORDER[b.severity] ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      (a.ruleId < b.ruleId ? -1 : 1),
  );
  const bySeverity: Record<Severity, number> = { blocker: 0, major: 0, minor: 0, info: 0 };
  for (const f of findings) {
    bySeverity[f.severity]++;
  }
  const used = new Set(findings.map((f) => f.ruleId));
  const ruleSummaries = rules
    .filter((r) => used.has(r.id))
    .map((r) => ({ id: r.id, title: r.title, category: r.category, severity: r.severity, confidence: r.confidence, remedy: r.remedy, verify: r.verify, refs: r.refs, message: r.message, effort: r.effort }));
  const groups = groupFindings({ findings, rules: ruleSummaries });
  return {
    tool: 'portdoctor',
    version: VERSION,
    root: basename(resolve(root)),
    disclaimer: DISCLAIMER,
    stats: {
      filesScanned: scanned,
      filesByKind: kindCount,
      filesSkipped: skipped.n,
      findings: findings.length,
      suppressedQnxBranch: counters.suppressed,
      suppressedNonCall: counters.nonCall,
      build: { source: build.source, findingsNotInBuildList: marked, note: build.note },
      rules: rules.length,
      bySeverity,
      effortMinutes: Math.round(totalEffort(groups)),
      ...(sdpStats ? { sdp: sdpStats } : {}),
    },
    findings,
    groups: groups.length,
    rules: ruleSummaries,
  };
}
