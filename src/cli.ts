import { writeFileSync, existsSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { scanDir, VERSION } from './scan.ts';
import { loadManifest } from './sdp.ts';
import { SEVERITIES } from './types.ts';
import { groupFindings, startHere, fmtRange } from './group.ts';
import type { Severity } from './types.ts';

const HELP = `portdoctor ${VERSION} - QNX 8.0 porting blocker scanner (static; nothing is compiled)

Usage:
  portdoctor scan <dir> [--json|--html|--sarif] [-o <file>] [--fail-on <severity>] [--sdp-manifest <file>]
  portdoctor propose <scan.json|dir> --finding <n> [--provider "<cmd>"] [--patch-file <f>] [--no-check]
  portdoctor fix <dir> --provider "<cmd>" [--check "<cmd>|qcc[:variant]"] [--sdp-manifest <file>] [--count N] [--rule ID] [--keep <dir>] [-o fix-report.html]
  portdoctor init-toolchain [<dir>] [--arch aarch64le|x86_64] [--out <dir>] [--force]
  portdoctor rules [--json]

scan:
  --json            machine-readable result (default output is a text summary)
  --sarif           SARIF 2.1.0 for CI/IDE
  --html            single-file HTML report
  -o <file>         write to file instead of stdout
  --fail-on <sev>   exit 1 if any finding at or above severity (blocker|major|minor|info)
  --ignore <regex>  skip paths matching the regex (repeatable), e.g. --ignore 'os390|mingw|/test/'
  --ignore-preset other-os   skip paths named for other OSes (os390, mingw, win32, darwin, freebsd, solaris, android ...): a heuristic, opt-in
  --no-build-awareness       do not read compile_commands.json / CMake / Makefile source lists
  --rules <dir>     use a different rules directory
  --sdp-manifest <file>   verify API/header/library claims against a manifest made from a real SDP (tools/sdp-manifest.mjs): findings become verified-present/verified-absent; APIs the SDP has are dropped
  --sdp-keep-present      keep findings the SDP disproves, as info, instead of dropping them
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
  const groups = groupFindings(r);
  const lines = [
    `PortDoctor ${r.version} - ${r.root}`,
    `${s.filesScanned} files scanned, ${s.findings} findings in ${groups.length} rule group${groups.length === 1 ? '' : 's'} (blocker ${s.bySeverity.blocker}, major ${s.bySeverity.major}, minor ${s.bySeverity.minor}, info ${s.bySeverity.info})`,
    `rough effort: ${fmtRange(s.effortMinutes)}`,
    `${s.suppressedQnxBranch} matches suppressed inside QNX-specific #if branches; ${s.suppressedNonCall} skipped as non-calls or user-defined functions`,
    ...(s.sdp ? [`SDP check (${s.sdp.build}): ${s.sdp.classified} findings decided: ${s.sdp.verifiedAbsent} verified-absent, ${s.sdp.verifiedPartial} partial, ${s.sdp.verifiedPresentDropped} dropped because the SDP has the API, ${s.sdp.verifiedPresentKept} kept as info; ${s.sdp.notCovered} API/header/lib findings not covered by the manifest`] : []),
    ...(s.build.source !== 'none' ? [`build awareness (heuristic): ${s.build.note}; ${s.build.findingsNotInBuildList} findings are in files it does not mention`] : []),
    '',
  ];
  const top = startHere(groups, 3);
  if (top.length) lines.push('Start here: ' + top.map((g) => `${g.title} (${g.sites.length} sites)`).join('; '), '');
  for (const g of groups) {
    lines.push(`${g.title}: ${g.sites.length} site${g.sites.length === 1 ? '' : 's'} in ${g.files.length} file${g.files.length === 1 ? '' : 's'}  [${g.severity}/${g.confidence}] ${g.ruleId}`);
    for (const i of g.sites) {
      const f = r.findings[i];
      lines.push(`  ${f.file}:${f.line}${f.guard === 'linux-only' ? ' (inside Linux-only #if)' : ''}`);
    }
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
    const sarif = flag(args, '--sarif');
    const out = opt(args, '-o');
    const failOn = opt(args, '--fail-on') as Severity | undefined;
    const rulesDir = opt(args, '--rules');
    const ignore: string[] = [];
    for (let v = opt(args, '--ignore'); v !== undefined; v = opt(args, '--ignore')) ignore.push(v);
    const presets: string[] = [];
    for (let v = opt(args, '--ignore-preset'); v !== undefined; v = opt(args, '--ignore-preset')) presets.push(v);
    const noBuild = flag(args, '--no-build-awareness');
    const sdpFile = opt(args, '--sdp-manifest');
    const keepPresent = flag(args, '--sdp-keep-present');
    const dir = args.shift();
    if (!dir || args.length) throw new Error('usage: portdoctor scan <dir> [--json|--html] [-o file]');
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`not a directory: ${dir}`);
    if (failOn && !SEVERITIES.includes(failOn)) throw new Error('--fail-on must be blocker|major|minor|info');
    const res = scanDir(dir, { rulesDir, ignore, ignorePresets: presets, buildAwareness: !noBuild, sdp: sdpFile ? loadManifest(sdpFile) : undefined, sdpKeepPresent: keepPresent });
    const renderHtml = html ? (await import('./report-html.ts')).renderHtml : null;
    const body = sarif ? JSON.stringify((await import('./sarif.ts')).toSarif(res), null, 2) + '\n' : renderHtml ? renderHtml(res) : json ? JSON.stringify(res, null, 2) + '\n' : textSummary(res);
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
  if (cmd === 'init-toolchain') {
    process.exitCode = await (await import('./init.ts')).runInit(args);
    return;
  }
  if (cmd === 'fix') {
    process.exitCode = await (await import('./fix.ts')).runFixCli(args);
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
