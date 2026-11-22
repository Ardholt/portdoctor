import { writeFileSync, existsSync, statSync } from 'node:fs';
import { scanDir, VERSION } from './scan.ts';
import { SEVERITIES } from './types.ts';
import type { Severity } from './types.ts';

const HELP = `portdoctor ${VERSION} - QNX 8.0 porting blocker scanner (static; nothing is compiled)

Usage:
  portdoctor scan <dir> [--json] [--html] [-o <file>] [--fail-on <severity>]
  portdoctor propose <scan.json|dir> --finding <n> [--provider "<cmd>"] [--patch-file <f>] [--no-check]
  portdoctor rules [--json]

scan:
  --json            machine-readable result (default output is a text summary)
  --html            single-file HTML report
  -o <file>         write to file instead of stdout
  --fail-on <sev>   exit 1 if any finding at or above severity (blocker|major|minor|info)
  --rules <dir>     use a different rules directory
`;

function flag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined) throw new Error(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}

export function textSummary(r: ReturnType<typeof scanDir>): string {
  const s = r.stats;
  const lines = [
    `PortDoctor ${r.version} - ${r.root}`,
    `${s.filesScanned} files scanned, ${s.findings} findings (blocker ${s.bySeverity.blocker}, major ${s.bySeverity.major}, minor ${s.bySeverity.minor}, info ${s.bySeverity.info}); ~${(s.effortMinutes / 60).toFixed(1)} h estimated effort (heuristic)`,
    `${s.suppressedQnxBranch} matches suppressed inside QNX-specific #if branches`,
    '',
  ];
  for (const f of r.findings) {
    lines.push(`${f.file}:${f.line}  [${f.severity}/${f.confidence}] ${f.ruleId}  ${f.title}${f.guard === 'linux-only' ? ' (inside Linux-only #if)' : ''}`);
  }
  lines.push('', r.disclaimer);
  return lines.join('\n') + '\n';
}

export async function main(argv: string[]): Promise<void> {
  const args = argv.slice();
  const cmd = args.shift();
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(VERSION + '\n');
    return;
  }
  if (cmd === 'scan') {
    const json = flag(args, '--json');
    const html = flag(args, '--html');
    const out = opt(args, '-o');
    const failOn = opt(args, '--fail-on') as Severity | undefined;
    const rulesDir = opt(args, '--rules');
    const dir = args.shift();
    if (!dir || args.length) throw new Error('usage: portdoctor scan <dir> [--json|--html] [-o file]');
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`not a directory: ${dir}`);
    if (failOn && !SEVERITIES.includes(failOn)) throw new Error('--fail-on must be blocker|major|minor|info');
    const res = scanDir(dir, { rulesDir });
    const renderHtml = html ? (await import('./report-html.ts')).renderHtml : null;
    const body = renderHtml ? renderHtml(res) : json ? JSON.stringify(res, null, 2) + '\n' : textSummary(res);
    if (out) writeFileSync(out, body);
    else process.stdout.write(body);
    if (failOn) {
      const lim = SEVERITIES.indexOf(failOn);
      if (res.findings.some((f) => SEVERITIES.indexOf(f.severity) <= lim)) process.exitCode = 1;
    }
    return;
  }
  if (cmd === 'rules') {
    const { loadRules } = await import('./rules.ts');
    const rs = loadRules();
    if (flag(args, '--json')) process.stdout.write(JSON.stringify(rs.map(({ re, ...r }) => r), null, 2) + '\n');
    else for (const r of rs) process.stdout.write(`${r.id.padEnd(34)} ${r.severity.padEnd(8)} ${r.confidence.padEnd(6)} ${r.title}\n`);
    return;
  }
  if (cmd === 'propose') {
    process.exitCode = await (await import('./propose.ts')).runPropose(args);
    return;
  }
  throw new Error(`unknown command: ${cmd}\n${HELP}`);
}

if (process.argv[1] && /cli\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e?.message ?? e);
    process.exit(2);
  });
}
