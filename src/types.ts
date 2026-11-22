export type Severity = 'blocker' | 'major' | 'minor' | 'info';
export type Confidence = 'known' | 'guess';
export type Kind = 'c' | 'cmake' | 'make' | 'autoconf';
export type Scope = 'code' | 'string' | 'include' | 'any';

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
  confidence: Confidence;
  appliesTo: Kind[];
  scope: Scope;
  effort: number;
  pattern?: string;
  flags?: string;
  project?: { requireKind: Kind; absent: string; reportOnKind: Kind };
  /** identifier -> regex source that must match somewhere in the file (a visible include/macro) before the identifier counts */
  evidence?: Record<string, string>;
  message: string;
  remedy: string;
  verify?: string;
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
  };
  findings: Finding[];
  /** number of rule groups (findings grouped by rule) */
  groups: number;
  rules: Array<Pick<Rule, 'id' | 'title' | 'category' | 'severity' | 'confidence' | 'remedy' | 'verify' | 'refs' | 'message' | 'effort'>>;
}

export const SEVERITIES: Severity[] = ['blocker', 'major', 'minor', 'info'];
