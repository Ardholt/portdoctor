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
}

export interface ScanOptions {
  maxFileBytes?: number;
  contextLines?: number;
  rulesDir?: string;
  ruleIds?: string[];
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
    rules: number;
    bySeverity: Record<Severity, number>;
    effortMinutes: number;
  };
  findings: Finding[];
  rules: Array<Pick<Rule, 'id' | 'title' | 'category' | 'severity' | 'confidence' | 'remedy' | 'verify' | 'refs' | 'message'>>;
}

export const SEVERITIES: Severity[] = ['blocker', 'major', 'minor', 'info'];
