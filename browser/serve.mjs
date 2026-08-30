/**
 * A static file server for fixture pages, so a measurement can run against a page
 * this repo controls.
 *
 * WebMCP needs a real origin: Chrome does not expose `document.modelContext` to
 * `file://`, and the fixture fetches a CSV beside itself, which `file://` blocks
 * anyway. This is deliberately the smallest thing that answers GET for a known set
 * of extensions - it serves fixtures on 127.0.0.1 and nothing else, so it is not a
 * general web server and must not grow into one.
 *
 * Port 0 lets the OS pick, which matters when sessions run concurrently: each
 * session process starts its own server, exactly as it starts its own browser.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export const startFixtureServer = async ({ root, port = 0, host = '127.0.0.1' }) => {
  const rootPath = resolve(root);
  const rootStat = await stat(rootPath).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error(`--serve needs a directory, got ${rootPath}`);

  const server = createServer(async (request, response) => {
    const requested = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = normalize(requested).replace(/^([/\\])+/, '');
    const filePath = join(rootPath, relative === '' ? 'index.html' : relative);

    // A fixture server that can be walked out of its own directory is a hole, even
    // on localhost: the harness runs it with the repo one level up.
    if (filePath !== rootPath && !filePath.startsWith(rootPath + sep)) {
      response.writeHead(403).end('outside the fixture root');
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(String(error.code ?? error));
    }
  });

  await new Promise((ready, failed) => {
    server.once('error', failed);
    server.listen(port, host, ready);
  });

  const address = server.address();

  return {
    port: address.port,
    origin: `http://${host}:${address.port}`,
    /** Resolves a fixture-relative path (query string included) against this server. */
    urlFor(pathAndQuery) {
      return new URL(String(pathAndQuery).replace(/^\/+/, ''), `http://${host}:${address.port}/`).href;
    },
    close: () =>
      new Promise((closed) => {
        server.closeAllConnections?.();
        server.close(closed);
      }),
  };
};
