# PortDoctor

A static scanner that finds the places a Linux/POSIX C/C++ project will likely need work to build and run on
**QNX 8.0**, tells you where (file:line), how bad it is, and what to do about it, and produces a single-file
HTML report you can hand to a team.

```
portdoctor scan ./my-project --html -o report.html
portdoctor scan ./my-project --json
portdoctor scan ./my-project            # text summary
```

## What it does

- Walks a tree of C/C++ sources, `CMakeLists.txt`/`*.cmake`, Makefiles, and `configure.ac`.
- Applies **55 rules** that live as data in `rules/*.json` (Linux-only APIs, glibc/Linux headers, `/proc` and `/sys`
  paths, build-system assumptions such as `-lrt`, hard-coded `gcc`, `-pie`, GNU-ld flags, CMake and autotools
  platform logic, and QNX-specific advice such as resource managers, `ionotify` and message passing).
- Understands enough C to avoid false hits in comments and string literals, and tracks `#if` nesting:
  matches inside `#ifdef __QNXNTO__` are suppressed (and counted); matches inside Linux-only blocks are flagged as such;
  other guards are recorded and shown, not judged.
- Every rule carries a **confidence**: `known` (documented QNX/POSIX behaviour the authors recall) or `guess`
  (unverified claim about QNX 8.0). Every `guess` says **verify against SDP**.
- The HTML report: summary, heat map by directory (or by file for flat trees), per-file findings with code context,
  effort estimate, severity/confidence/text filters, remedies and rule notes, light/dark theme, keyboard shortcuts
  (`/` search, `j`/`k` move, `1`-`4` severities, `t` theme, `?` help), skip link, ARIA labels, no colour-only signals,
  print-friendly, works without JS (filters need JS).

## Run it

Needs Node.js **22.18 or newer** (it runs TypeScript directly via Node's built-in type stripping; no build step,
no dependencies, nothing to `npm install`).

```
git clone <this repo> && cd portdoctor
node bin/portdoctor.mjs scan <dir> --html -o report.html
node --test tests/
```

Options: `--json`, `--html`, `-o <file>`, `--fail-on <blocker|major|minor|info>` (exit 1, for CI),
`--ignore <regex>` (repeatable; skip other-OS paths such as `os390|mingw`), `--rules <dir>`.
`portdoctor rules` lists the rule set.

## AI hook (interface only)

`portdoctor propose <dir|scan.json> --finding <n> [--root <dir>]` builds a request for one finding: a prompt
(rule, remedy, a numbered code window, instructions not to invent QNX facts) and a JSON schema for the answer
(`unifiedDiff`, `explanation`, `assumptions`, `verifyAgainstSdp`, `confidence`, `needsHuman`).
`--finding` is the 0-based index into `findings[]` (the `#f-N` anchor in the HTML report).

- With no provider it prints that request and stops. **PortDoctor never calls a model and makes no network calls.**
- `--provider "<command>"` runs your command with the request JSON on stdin and reads one JSON object from stdout.
  Wire it to whatever you use (a CLI, a script that calls an API).
- The response is validated against the schema and its patch is checked with `git apply --check` (paths outside
  the project root are refused). Exit codes: 0 accepted, 1 rejected, 3 provider failed.
- `--patch-file <f>` validates a saved response without running a provider. `portdoctor propose --schema` prints the schema.

A patch that applies cleanly has **not** been compiled for QNX; that check needs the SDP's `qcc`.

## Honest limits

- **No QNX SDP was available.** Nothing was compiled or run on QNX. Findings are text matches.
- Claims about what QNX 8.0 lacks are from the authors' recollection of public documentation, not checked
  against headers. `known` means "documented and recalled", not "verified in this build". `refs` list documentation
  page names, not fetched URLs.
- The scanner cannot know which files your build compiles. Linux-only source files in cross-platform projects
  (for example a project's `linux.c`) are reported as if built. Use `--ignore`, and read the guards shown on each finding.
- Feature-macro guards (`#ifdef HAVE_EPOLL`) are shown, not evaluated, so portable projects are over-reported.
- Effort figures are rule-based heuristics (30% for repeats of one rule in a file, half inside Linux-only blocks),
  not measurements.
- A clean scan is not proof of portability: false negatives are not measured (macros, generated code, assembly,
  other languages in the build).
- Tested on Linux with Node 26 only. macOS/Windows are intended (path handling is portable) but not run.
- See `corpus/CORPUS.md` for a hand review of 30 findings on seven open-source projects: about 53% strict precision
  on that sample before four rule bugs were fixed.

## Layout

```
bin/portdoctor.mjs   entry point
src/                 scan.ts (walker, comment/string masking, #if tracking), rules.ts, report-html.ts, propose.ts, cli.ts
rules/*.json         the rules (data), each with positive and negative examples used by the tests
tests/               node --test
corpus/              pinned scans of seven OSS projects, reports, hand review
```

Adding a rule: append an object to a `rules/*.json` file with `id`, `severity`, `confidence`, `appliesTo`,
`scope` (`code` | `string` | `include` | `any`), `pattern`, `message`, `remedy`, and at least one positive and one
negative example; `node --test` will exercise it.

## Licence

MIT. See `LICENSE`.
