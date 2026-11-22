#!/usr/bin/env node
import('../src/cli.ts').then((m) => m.main(process.argv.slice(2))).catch((e) => {
  console.error(e?.message ?? e);
  process.exit(2);
});
