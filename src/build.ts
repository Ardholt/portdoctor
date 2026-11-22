import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve, relative, isAbsolute, sep } from 'node:path';

/**
 * Build awareness, best effort and HEURISTIC. Reads compile_commands.json (preferred) or the source lists named in
 * CMakeLists.txt / Makefile / Makefile.am to learn which translation units a build mentions. A file that is absent from a
 * non-empty list is flagged "not in build list?". This is a sensor, not a verdict: lists built with globs, variables,
 * generated sources or on a different OS than the target cannot be understood, and then nothing is flagged.
 */
export interface BuildInfo {
  source: 'compile_commands.json' | 'build files' | 'none';
  /** relative posix paths of translation units mentioned; null when nothing usable */
  compiled: Set<string> | null;
  note: string;
}

const TU = /\.(?:c|cc|cpp|cxx|c\+\+)$/i;
const SRC_TOKEN = /[\w${}@./+-]+\.(?:c|cc|cpp|cxx|c\+\+)\b/gi;

export const isTranslationUnit = (f: string): boolean => TU.test(f);

function norm(p: string): string {
  return posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '');
}

function strip(tok: string): string {
  return tok
    .replace(/\$\{?\(?(?:CMAKE_CURRENT_SOURCE_DIR|PROJECT_SOURCE_DIR|CMAKE_SOURCE_DIR|srcdir|abs_srcdir|top_srcdir|CMAKE_CURRENT_LIST_DIR|PROJECT_DIR)\)?\}?\/?/g, '')
    .replace(/^@srcdir@\/?/, '');
}

export function collectBuildInfo(root: string, files: Array<{ rel: string; kind: string; text: string }>): BuildInfo {
  for (const cand of ['compile_commands.json', 'build/compile_commands.json']) {
    const p = join(root, cand);
    if (!existsSync(p)) continue;
    try {
      const arr = JSON.parse(readFileSync(p, 'utf8')) as Array<{ directory?: string; file?: string }>;
      const set = new Set<string>();
      for (const e of arr) {
        if (!e.file) continue;
        const abs = isAbsolute(e.file) ? e.file : resolve(e.directory ?? root, e.file);
        const rel = relative(resolve(root), abs);
        if (!rel.startsWith('..') && !isAbsolute(rel)) set.add(norm(rel.split(sep).join('/')));
      }
      if (set.size) return { source: 'compile_commands.json', compiled: set, note: `${set.size} translation units in ${cand} (whatever build produced it, not necessarily a QNX build)` };
    } catch {
      /* fall through to build files */
    }
  }
  const set = new Set<string>();
  let globs = false;
  let used = 0;
  for (const f of files) {
    if (f.kind !== 'cmake' && f.kind !== 'make') continue;
    const dir = posix.dirname(f.rel) === '.' ? '' : posix.dirname(f.rel);
    const text = f.text.replace(/\r\n?/g, '\n').replace(/^[ \t]*#.*$/gm, '').replace(/\s#.*$/gm, '');
    if (/\bfile\s*\(\s*GLOB|aux_source_directory\s*\(|\$\(wildcard|\$\(shell\s+(?:ls|find)|\$\(foreach/i.test(text)) globs = true;
    let body = text;
    if (f.kind === 'cmake') body = [...text.matchAll(/\b(?:add_executable|add_library|target_sources|set|list)\s*\(([^)]*)\)/gi)].map((m) => m[1]).join('\n');
    for (const m of body.matchAll(SRC_TOKEN)) {
      const t = strip(m[0]);
      if (t.includes('$')) continue;
      set.add(norm(posix.join(dir, t)));
      used++;
    }
    if (f.kind === 'make') {
      for (const m of text.matchAll(/[\w./+-]+\.o\b/g)) {
        used++;
        for (const ext of ['c', 'cc', 'cpp', 'cxx']) set.add(norm(posix.join(dir, m[0].replace(/\.o$/, '.' + ext))));
      }
    }
  }
  if (globs) return { source: 'none', compiled: null, note: 'build files use globs/wildcards: source lists are not knowable, nothing was marked' };
  if (!used) return { source: 'none', compiled: null, note: 'no compile_commands.json and no source lists found in build files' };
  return { source: 'build files', compiled: set, note: `${set.size} source paths named in CMake/Makefile lists (variables and generated sources are not followed)` };
}
