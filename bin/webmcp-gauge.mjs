#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const { name, version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);

const usage = `${name} ${version}

Usage: webmcp-gauge <command> [options]

Commands:
  probe <url>    read the page's registered tool manifest     (not implemented)
  lint <url>     static checks on the manifest, no model      (not implemented)
  run <url>      fire the utterance set, score every outcome  (not implemented)

Options:
  -h, --help     print this message
  -v, --version  print the version

No command is implemented yet. This entry point exists so the package layout is
verifiable before the harness is written; see docs/getting-started.md section 2.`;

const command = process.argv[2];

if (command === undefined || command === '--help' || command === '-h') {
  console.log(usage);
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  console.log(version);
  process.exit(0);
}

console.error(`webmcp-gauge: no such command '${command}'\n`);
console.error(usage);
process.exit(2);
