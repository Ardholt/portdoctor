import type { ScanResult, Severity } from './types.ts';
import { VERSION } from './scan.ts';

const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = { blocker: 'error', major: 'warning', minor: 'note', info: 'note' };

/** SARIF 2.1.0 for CI/IDE consumers. Severity maps blocker->error, major->warning, minor/info->note; the original severity is kept in properties. */
export function toSarif(res: ScanResult): object {
  const rules = res.rules.map((r) => ({
    id: r.id,
    name: r.title,
    shortDescription: { text: r.title },
    fullDescription: { text: r.message },
    help: { text: `${r.remedy}${r.verify ? ' ' + r.verify : ''}` },
    defaultConfiguration: { level: LEVEL[r.severity] },
    properties: { severity: r.severity, confidence: r.confidence, category: r.category, tags: ['qnx-porting', r.confidence === 'guess' ? 'unverified-against-sdp' : 'recalled-from-docs'] },
  }));
  const index = new Map(rules.map((r, i) => [r.id, i]));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'portdoctor', version: VERSION, rules } },
        results: res.findings.map((f, i) => ({
          ruleId: f.ruleId,
          ruleIndex: index.get(f.ruleId),
          level: LEVEL[f.severity],
          message: { text: `${f.title}: ${f.message}${f.confidence === 'guess' ? ' (guess: verify against SDP)' : ''}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file, uriBaseId: '%SRCROOT%' },
                region: { startLine: f.line, startColumn: f.column, ...(f.match && f.match !== '(project-level)' ? { snippet: { text: f.match } } : {}) },
              },
            },
          ],
          properties: { severity: f.severity, confidence: f.confidence, guard: f.guard, guards: f.guards, findingIndex: i },
        })),
        originalUriBaseIds: { '%SRCROOT%': { description: { text: `scan root: ${res.root}` } } },
      },
    ],
  };
}
