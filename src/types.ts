export type Severity = 'blocker' | 'major' | 'minor' | 'info';
export type Confidence = 'known' | 'guess' | 'verified-present' | 'verified-absent' | 'verified-partial';
export type RuleConfidence = 'known' | 'guess';
export type Kind = 'c' | 'cmake' | 'make' | 'autoconf';
export type Scope = 'code' | 'string' | 'include' | 'any';

export interface SdpOverride { message?: string; remedy?: string; severity?: Severity; keep?: boolean }

export interface RuleExample {
  kind?: Kind;
  text?: string;
  files?: Record<string, string>;
}

export interface Rule {
  id: string;
  title: string;
  category: 'linux-api' | 'build' | 'advice';
  severity: Severity;
  confidence: RuleConfidence;
  appliesTo: Kind[];
  scope: Scope;
  effort: number;
  pattern?: string;
  flags?: string;
  /** project-level: fires once if a file of requireKind exists, `absent` matches no file, (optionally) C code matches requireCode; reported on the first file of reportOnKind, else of the reportFallback kinds */
  project?: { requireKind: Kind; absent: string; reportOnKind: Kind; requireCode?: string; reportFallback?: Kind[] };
  /** identifier -> regex source that must match somewhere in the file (a visible include/macro) before the identifier counts */
  evidence?: Record<string, string>;
  message: string;
  remedy: string;
  verify?: string;
  /** what to say once the SDP manifest has decided the finding: per verdict, replaces message/remedy (and may keep a 'present' finding as a lower severity) */
  sdp?: { absent?: SdpOverride; present?: SdpOverride; partial?: SdpOverride };
  refs?: string[];
  examples: { positive: Array<string | RuleExample>; negative: Array<string | RuleExample> };
}

export interface CompiledRule extends Rule {
  re?: RegExp;
}

export interface ContextLine {
  n: number;
  text: string;
}

export interface Finding {
  ruleId: string;
  title: string;
  category: string;
  severity: Severity;
  confidence: Confidence;
  file: string;
  line: number;
  column: number;
  match: string;
  context: ContextLine[];
  message: string;
  remedy: string;
  verify?: string;
  effort: number;
  guard: 'none' | 'linux-only' | 'other';
  guards: string[];
  /** build awareness (heuristic): 'no' = file not found in the build target list; absent = unknown */
  built?: 'no';
  /** set when --sdp-manifest decided this finding against the installed SDP */
  sdp?: { verdict: 'present' | 'absent' | 'partial'; items: Array<{ what: string; kind: string; result: string; evidence: string; needsLib?: string }>; build: string };
}

export interface ScanOptions {
  maxFileBytes?: number;
  contextLines?: number;
  rulesDir?: string;
  ruleIds?: string[];
  ignore?: string[];
  ignorePresets?: string[];
  /** default true: read compile_commands.json / CMake / Makefile source lists and flag files not in them */
  buildAwareness?: boolean;
  /** parsed data/sdp-8.0-manifest.json: verify API/header/lib claims against the SDP */
  sdp?: import('./sdp.ts').SdpManifest;
  /** keep findings whose API the SDP has (as info) instead of dropping them */
  sdpKeepPresent?: boolean;
}

export interface ScanResult {
  tool: string;
  version: string;
  root: string;
  disclaimer: string;
  stats: {
    filesScanned: number;
    filesByKind: Record<string, number>;
    filesSkipped: number;
    findings: number;
    suppressedQnxBranch: number;
    suppressedNonCall: number;
    /** heuristic build awareness: where the list came from and how many findings sit in files it does not mention */
    build: { source: string; findingsNotInBuildList: number; note: string };
    rules: number;
    bySeverity: Record<Severity, number>;
    effortMinutes: number;
    sdp?: { build: string | null; classified: number; verifiedAbsent: number; verifiedPartial: number; verifiedPresentKept: number; verifiedPresentDropped: number; notCovered: number; droppedByRule: Record<string, string[]>; uncovered: string[] };
  };
  findings: Finding[];
  /** number of rule groups (findings grouped by rule) */
  groups: number;
  rules: Array<Pick<Rule, 'id' | 'title' | 'category' | 'severity' | 'confidence' | 'remedy' | 'verify' | 'refs' | 'message' | 'effort'>>;
}

export const SEVERITIES: Severity[] = ['blocker', 'major', 'minor', 'info'];
