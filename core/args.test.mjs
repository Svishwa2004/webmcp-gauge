import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOptions } from './args.mjs';

const spec = { values: ['url', 'fail-under', 'serve'], switches: ['json', 'resume'], maxPositional: 1 };

test('both option syntaxes mean the same thing', () => {
  const equals = parseOptions(['--url=https://example.com', '--fail-under=0.9'], spec);
  const spaced = parseOptions(['--url', 'https://example.com', '--fail-under', '0.9'], spec);
  assert.equal(equals.error, null);
  assert.equal(spaced.error, null);
  assert.deepEqual(equals.options, spaced.options);
  assert.equal(equals.options['fail-under'], '0.9');
});

/**
 * The two bugs this parser exists for, one per surface, both of which left a
 * default in place and said nothing: `--fail-under=0.9` was a switch named
 * `fail-under=0.9` in the CLI, so nothing was gated; `--serve fixtures/gallery`
 * never reached the probes, so a rehearsal walked the live gallery.
 */
test('the equals form reaches the gate, which it did not in the old CLI parser', () => {
  const { options } = parseOptions(['--fail-under=0.9'], spec);
  assert.equal(options['fail-under'], '0.9');
  assert.equal(options['fail-under=0.9'], undefined);
});

test('the space form reaches the probes, which it did not before', () => {
  const { options, error } = parseOptions(['--serve', 'fixtures/gallery', '--json'], spec);
  assert.equal(error, null);
  assert.equal(options.serve, 'fixtures/gallery');
  assert.equal(options.json, true);
});

test('an unknown option is refused and the known ones are listed', () => {
  const { error } = parseOptions(['--fail-undr=0.9'], spec);
  assert.match(error, /unknown option '--fail-undr'/);
  assert.match(error, /--fail-under/);
});

test('a value option with no value is refused rather than read as true', () => {
  assert.match(parseOptions(['--url'], spec).error, /--url needs a value/);
  assert.match(parseOptions(['--url', '--json'], spec).error, /--url needs a value/);
});

test('a switch handed a value is refused rather than silently truthy', () => {
  assert.match(parseOptions(['--json=yes'], spec).error, /--json is a switch and takes no value/);
});

test('a switch does not swallow the token after it', () => {
  const { options, positional, error } = parseOptions(['--json', 'subject.html'], spec);
  assert.equal(error, null);
  assert.equal(options.json, true);
  assert.deepEqual(positional, ['subject.html']);
});

test('a positional beyond the declared budget is refused, and names the option it may belong to', () => {
  const { error } = parseOptions(['--json', 'one', 'two'], spec);
  assert.match(error, /unexpected argument 'two'/);
});

test('`--resume yes` is refused, and the message says the switch takes no value', () => {
  const { error } = parseOptions(['--resume', 'yes'], { ...spec, maxPositional: 0 });
  assert.match(error, /unexpected argument 'yes'/);
  assert.match(error, /--resume takes no value/);
});

test('an equals value keeps everything after the first equals', () => {
  const { options } = parseOptions(['--url=https://example.com/?a=1&b=2'], spec);
  assert.equal(options.url, 'https://example.com/?a=1&b=2');
});

test('a value that looks like a flag is refused rather than consumed', () => {
  const { error } = parseOptions(['--serve', '--json'], spec);
  assert.match(error, /--serve needs a value/);
});

test('empty argv parses to nothing', () => {
  const { options, positional, error } = parseOptions([], spec);
  assert.equal(error, null);
  assert.deepEqual(options, {});
  assert.deepEqual(positional, []);
  assert.equal(parseOptions(undefined, spec).error, null);
});
