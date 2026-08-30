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
import { watchBrowserTools } from './webmcp.mjs';

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
