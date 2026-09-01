/**
 * One-shot: extract printable ASCII strings around every case-insensitive
 * "webmcp" hit in a binary, to learn what WebMCP feature/flag names a build
 * actually compiled in. Not part of the harness; evidence for PROJECT-LOG.
 *
 * Usage: node probes/binary-webmcp-strings.mjs <path-to-binary> [contextBytes]
 */
import { open } from 'node:fs/promises';

const file = process.argv[2];
const context = Number(process.argv[3] ?? 48);
if (!file) {
  console.error('usage: node probes/binary-webmcp-strings.mjs <binary> [contextBytes]');
  process.exit(2);
}

const handle = await open(file, 'r');
const chunkSize = 1 << 24; // 16 MiB
const overlap = 256;
let offset = 0;
let tail = Buffer.alloc(0);
const hits = new Map();

while (true) {
  const buffer = Buffer.alloc(chunkSize);
  const { bytesRead } = await handle.read(buffer, 0, chunkSize, offset);
  if (bytesRead === 0) break;
  const data = Buffer.concat([tail, buffer.subarray(0, bytesRead)]);
  const text = data.toString('latin1');
  const lower = text.toLowerCase();
  let index = lower.indexOf('webmcp');
  while (index !== -1) {
    const start = Math.max(0, index - context);
    const end = Math.min(text.length, index + context + 6);
    const slice = text
      .slice(start, end)
      // Keep only printable runs so the output is strings, not binary noise.
      .replace(/[^\x20-\x7E]+/g, '·')
      .trim();
    hits.set(slice, (hits.get(slice) ?? 0) + 1);
    index = lower.indexOf('webmcp', index + 1);
  }
  tail = data.subarray(Math.max(0, data.length - overlap));
  offset += bytesRead;
}
await handle.close();

console.log(`file: ${file}`);
console.log(`distinct string contexts: ${hits.size}`);
for (const [slice, count] of [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80)) {
  console.log(`${String(count).padStart(4)} × ${slice}`);
}
