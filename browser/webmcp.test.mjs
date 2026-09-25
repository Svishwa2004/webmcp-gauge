/**
 * The browser-side tool view, which is the only way `not_discovered` can ever fire.
 *
 * Tested against a fake session because what matters is the accumulation contract,
 * not Chrome: the WebMCP domain has no command that lists tools, so the view is
 * assembled from a stream of events and every rule about that assembly - one event
 * per registration, removals, an unavailable domain, unsubscribing - is logic this
 * repo owns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { watchBrowserTools, watchBrowserToolsAtBrowser } from './webmcp.mjs';

const fakeSession = ({ available = true, reason = null } = {}) => {
  const subscribers = new Map();
  return {
    subscribe(method, handler) {
      const handlers = subscribers.get(method) ?? new Set();
      handlers.add(handler);
      subscribers.set(method, handlers);
      return () => handlers.delete(handler);
    },
    async enableWebMcpDomain() {
      return available ? { available: true } : { available: false, reason };
    },
    emit(method, params) {
      for (const handler of [...(subscribers.get(method) ?? [])]) handler(params);
    },
    subscriberCount() {
      let total = 0;
      for (const handlers of subscribers.values()) total += handlers.size;
      return total;
    },
  };
};

const tool = (name) => ({ name, description: `${name} does something`, frameId: 'F1' });

test('the view accumulates across one event per registration, which is how Chrome sends them', async () => {
  const session = fakeSession();
  const watch = await watchBrowserTools(session);

  // Measured on Chrome 152: each registerTool produces its own toolsAdded event, so
  // a reader that waits for one event sees one tool and calls the rest missing.
  session.emit('WebMCP.toolsAdded', { tools: [tool('describe_dataset')] });
  session.emit('WebMCP.toolsAdded', { tools: [tool('filter_rows')] });
  session.emit('WebMCP.toolsAdded', { tools: [tool('top_expenses'), tool('monthly_trend')] });

  assert.deepEqual(watch.names(), [
    'describe_dataset',
    'filter_rows',
    'top_expenses',
    'monthly_trend',
  ]);
  assert.equal(watch.tools().length, 4);
  assert.equal(watch.tools()[0].frameId, 'F1', 'the browser knows which frame registered it');
});

test('a removed tool leaves the view and is remembered as removed', async () => {
  const session = fakeSession();
  const watch = await watchBrowserTools(session);

  session.emit('WebMCP.toolsAdded', { tools: [tool('filter_rows'), tool('clear_highlights')] });
  session.emit('WebMCP.toolsRemoved', { tools: [{ name: 'clear_highlights', frameId: 'F1' }] });

  assert.deepEqual(watch.names(), ['filter_rows']);
  assert.deepEqual(watch.removedNames(), ['clear_highlights']);
});

test('re-registering a name after removal puts it back exactly once', async () => {
  const session = fakeSession();
  const watch = await watchBrowserTools(session);

  session.emit('WebMCP.toolsAdded', { tools: [tool('filter_rows')] });
  session.emit('WebMCP.toolsRemoved', { tools: [{ name: 'filter_rows' }] });
  session.emit('WebMCP.toolsAdded', { tools: [tool('filter_rows')] });
  session.emit('WebMCP.toolsAdded', { tools: [tool('filter_rows')] });

  // Names are the unit of selection, so the view is keyed by name: two tools with
  // one name are one thing an agent can call, not two.
  assert.deepEqual(watch.names(), ['filter_rows']);
});

test('an unavailable domain reports null rather than an empty list', async () => {
  const session = fakeSession({ available: false, reason: "'WebMCP.enable' wasn't found" });
  const watch = await watchBrowserTools(session);

  // The distinction the classifier depends on: no view at all must never read as
  // "the browser surfaced nothing", or every trial on an older build would become
  // not_discovered.
  assert.equal(watch.available, false);
  assert.equal(watch.names(), null);
  assert.equal(watch.tools(), null);
  assert.equal(watch.removedNames(), null);
  assert.match(watch.reason, /WebMCP\.enable/);
  assert.equal(session.subscriberCount(), 0, 'an unavailable watch must not leave subscribers behind');
});

test('events without a usable name are ignored rather than crashing the reader', async () => {
  const session = fakeSession();
  const watch = await watchBrowserTools(session);

  session.emit('WebMCP.toolsAdded', {});
  session.emit('WebMCP.toolsAdded', { tools: [{ description: 'no name' }, null] });
  session.emit('WebMCP.toolsRemoved', { tools: [{ frameId: 'F2' }] });

  assert.deepEqual(watch.names(), []);
  assert.deepEqual(watch.removedNames(), []);
});

test('stop() unsubscribes, so a closed trial cannot keep collecting', async () => {
  const session = fakeSession();
  const watch = await watchBrowserTools(session);

  session.emit('WebMCP.toolsAdded', { tools: [tool('filter_rows')] });
  assert.equal(session.subscriberCount(), 2);

  watch.stop();
  session.emit('WebMCP.toolsAdded', { tools: [tool('late_tool')] });

  assert.equal(session.subscriberCount(), 0);
  assert.deepEqual(watch.names(), ['filter_rows']);
});

/**
 * The browser-endpoint view is tested against a fake socket for the same reason
 * the host-attached one is tested against a fake session: the accumulation
 * contract across sessions is this repo's logic, and Chrome is not. The fake
 * answers CDP commands the way a build does — every command succeeds except
 * `WebMCP.enable` when the scenario wants a build without the domain — and the
 * tests drive `attachedToTarget` and the WebMCP events in the shapes Chrome
 * delivers in flatten mode, tagged with the `sessionId` of the target each
 * event came from.
 */
class FakeSocket {
  constructor({ enableResult = 'ok' } = {}) {
    this.enableResult = enableResult;
    this.sent = [];
    this.closed = false;
    this.handlers = new Map();
    queueMicrotask(() => this.emit('open'));
  }

  addEventListener(type, handler) {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  emit(type, event = {}) {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler(event);
  }

  send(text) {
    const message = JSON.parse(text);
    this.sent.push(message);
    const reply =
      message.method === 'WebMCP.enable' && this.enableResult !== 'ok'
        ? { error: { code: -32601, message: this.enableResult } }
        : { result: {} };
    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: message.id, ...reply }) }));
  }

  close() {
    this.closed = true;
  }
}

const openWatch = async ({ enableResult = 'ok' } = {}) => {
  const socket = new FakeSocket({ enableResult });
  const watch = await watchBrowserToolsAtBrowser('ws://browser', {
    WebSocket: class {
      constructor() {
        return socket;
      }
    },
  });
  return { watch, socket };
};

/** Attaches a target the way flattened auto-attach reports one. */
const attach = (socket, sessionId, type = 'page') =>
  socket.emit('message', {
    data: JSON.stringify({
      method: 'Target.attachedToTarget',
      params: {
        sessionId,
        targetInfo: { targetId: `T-${sessionId}`, type, url: 'http://site.example/' },
      },
    }),
  });

const added = (socket, sessionId, names) =>
  socket.emit('message', {
    data: JSON.stringify({
      method: 'WebMCP.toolsAdded',
      sessionId,
      params: { tools: names.map((name) => ({ name, description: `${name} does something`, frameId: 'F1' })) },
    }),
  });

const removedOne = (socket, sessionId, name) =>
  socket.emit('message', {
    data: JSON.stringify({
      method: 'WebMCP.toolsRemoved',
      sessionId,
      params: { tools: [{ name, frameId: 'F1' }] },
    }),
  });

const settle = () => new Promise((done) => setTimeout(done, 0));

test('the browser-endpoint view reaches a cross-site embed the host session cannot hear', async () => {
  const { watch, socket } = await openWatch();

  attach(socket, 'S1', 'page');
  attach(socket, 'S2', 'iframe');
  await settle();

  added(socket, 'S1', ['host_alpha', 'host_beta', 'host_gamma']);
  added(socket, 'S2', ['widget_ping']);

  // The 2026-09-05 measurement, replayed: 4 tools across 2 sessions where the
  // host-attached view stops at 3. The counters are what make the number
  // interpretable — an iframe session did attach, and the union came from both.
  assert.deepEqual(watch.names(), ['host_alpha', 'host_beta', 'host_gamma', 'widget_ping']);
  assert.equal(watch.tools().length, 4);
  assert.equal(watch.available, true);
  assert.equal(watch.oopiFrames, 1);
  assert.equal(watch.toolSessionCount, 2);

  // Recursion is the fix, so it is pinned: one arm on the browser session, then
  // one per attached session. A single arm measured 6 targets with no iframe
  // among them and saw 3 tools.
  const arms = socket.sent.filter((message) => message.method === 'Target.setAutoAttach');
  assert.equal(arms.length, 3, 'auto-attach must be armed on the browser session and on every attached session');
  assert.equal(arms[1].sessionId, 'S1');
  assert.equal(arms[2].sessionId, 'S2');
});

test('a removal from one session leaves the union and is remembered', async () => {
  const { watch, socket } = await openWatch();

  attach(socket, 'S1', 'page');
  attach(socket, 'S2', 'iframe');
  await settle();

  added(socket, 'S1', ['host_alpha', 'host_beta']);
  added(socket, 'S2', ['widget_ping']);
  removedOne(socket, 'S2', 'widget_ping');

  assert.deepEqual(watch.names(), ['host_alpha', 'host_beta']);
  assert.deepEqual(watch.removedNames(), ['widget_ping']);
});

test('a build whose every enable refuses reports unavailable, not empty', async () => {
  const { watch, socket } = await openWatch({ enableResult: "'WebMCP.enable' wasn't found" });

  attach(socket, 'S1', 'page');
  attach(socket, 'S2', 'iframe');
  await settle();

  added(socket, 'S1', ['host_alpha']);

  // The distinction the classifier depends on travels across sessions too: no
  // view at all must never read as "the browser surfaced nothing".
  assert.equal(watch.available, false);
  assert.equal(watch.names(), null);
  assert.equal(watch.tools(), null);
  assert.equal(watch.removedNames(), null);
  assert.match(watch.reason, /WebMCP\.enable/);
});

test('a run where no target ever attached reports that, not an empty union', async () => {
  const { watch } = await openWatch();

  // The same exit-2 distinction browser-scope.mjs had to learn the hard way:
  // "auto-attach reached nothing" and "the browser cannot see it" are different
  // findings, and only one of them is about WebMCP.
  assert.equal(watch.available, false);
  assert.equal(watch.names(), null);
  assert.equal(watch.oopiFrames, 0);
  assert.equal(watch.toolSessionCount, 0);
  assert.match(watch.reason, /no target session attached/);
});

test('stop() closes the socket, so a closed capture cannot keep collecting', async () => {
  const { watch, socket } = await openWatch();

  attach(socket, 'S1', 'page');
  await settle();
  added(socket, 'S1', ['host_alpha']);

  watch.stop();
  assert.equal(socket.closed, true);

  added(socket, 'S1', ['late_tool']);
  assert.deepEqual(watch.names(), ['host_alpha']);
});
