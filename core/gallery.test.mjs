import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyLink, pickTarget, galleryPageUrl, toHarvest } from './gallery.mjs';

test('a repo host is a repo, however it is spelled', () => {
  assert.equal(classifyLink('https://github.com/user/project'), 'repo');
  assert.equal(classifyLink('https://www.github.com/user/project'), 'repo');
  assert.equal(classifyLink('https://gitlab.com/user/project'), 'repo');
});

test('videos, socials and package pages are not pages to measure', () => {
  assert.equal(classifyLink('https://youtu.be/abc123'), 'video');
  assert.equal(classifyLink('https://www.youtube.com/watch?v=abc'), 'video');
  assert.equal(classifyLink('https://x.com/someone/status/1'), 'social');
  assert.equal(classifyLink('https://www.npmjs.com/package/thing'), 'artefact');
  assert.equal(classifyLink('https://devpost.com/software/thing'), 'artefact');
});

/**
 * Measured on a real project page (2026-09-01), where Devpost's own footer and
 * sponsor rail offered these alongside the entrant's links. Left unnamed, each
 * one classifies as a demo, and the first-wins rule would then record a sponsor's
 * marketing site as somebody's submission.
 */
test("Devpost's own chrome and asset hosts are not somebody's submission", () => {
  assert.equal(classifyLink('https://devpost.team/'), 'artefact');
  assert.equal(classifyLink('https://d112y698adiu2z.cloudfront.net/photos/x.png'), 'artefact');
  assert.equal(classifyLink('https://devpost-file-uploads.s3.amazonaws.com/x.pdf'), 'artefact');
});

test('anything else is a demo candidate, including subdomains of free hosting', () => {
  assert.equal(classifyLink('https://my-app.netlify.app'), 'demo');
  assert.equal(classifyLink('https://project.vercel.app/demo'), 'demo');
  assert.equal(classifyLink('https://user.github.io/project'), 'demo', 'pages hosting is a live page, not a repo');
});

test('a malformed link is unusable rather than a demo', () => {
  assert.equal(classifyLink('not a url'), 'unusable');
  assert.equal(classifyLink(''), 'unusable');
});

test('the first demo link wins, and the repo is captured beside it', () => {
  const pick = pickTarget({
    title: '  Airlock  ',
    devpostUrl: 'https://devpost.com/software/airlock',
    links: [
      'https://github.com/user/airlock',
      'https://airlock-app.netlify.app',
      'https://backup.example/airlock',
      'https://youtu.be/demo',
    ],
  });

  assert.equal(pick.project, 'Airlock');
  assert.equal(pick.url, 'https://airlock-app.netlify.app');
  assert.equal(pick.repo, 'https://github.com/user/airlock');
  assert.deepEqual(pick.otherDemoCandidates, ['https://backup.example/airlock']);
  assert.equal(pick.skipReason, null);
});

test('a submission with only a repo and a video is skipped with the reason recorded', () => {
  const pick = pickTarget({
    title: 'CLI thing',
    devpostUrl: 'https://devpost.com/software/cli-thing',
    links: ['https://github.com/user/cli', 'https://youtu.be/x'],
  });

  assert.equal(pick.url, null);
  assert.equal(pick.repo, 'https://github.com/user/cli');
  assert.match(pick.skipReason, /no demo-class link/);
});

test('a project with no links at all is skipped rather than throwing', () => {
  const pick = pickTarget({ title: 'Empty', devpostUrl: 'https://devpost.com/software/empty' });
  assert.equal(pick.url, null);
  assert.ok(pick.skipReason);
});

test('an untitled submission falls back to a name rather than an empty string', () => {
  const pick = pickTarget({ title: '   ', devpostUrl: 'https://devpost.com/software/x', links: [] });
  assert.equal(pick.project, 'devpost.com');
});

test('labelled links are accepted in object form as well as bare strings', () => {
  const pick = pickTarget({
    title: 'Mixed',
    devpostUrl: null,
    links: [{ url: 'https://demo.example', label: 'Try it out' }, 'https://github.com/a/b'],
  });
  assert.equal(pick.url, 'https://demo.example');
  assert.equal(pick.repo, 'https://github.com/a/b');
});

test('page 1 carries no page parameter, and later pages do', () => {
  const base = 'https://webmcp.devpost.com/project-gallery';
  assert.equal(galleryPageUrl(base, 1), `${base}`);
  assert.equal(galleryPageUrl(base, 3), `${base}?page=3`);
});

test('an existing query string on the gallery URL survives pagination', () => {
  const base = 'https://webmcp.devpost.com/project-gallery?sort=recent';
  assert.equal(galleryPageUrl(base, 2), 'https://webmcp.devpost.com/project-gallery?sort=recent&page=2');
});

test('the harvest separates what can be measured from what was dropped, and counts both', () => {
  const picks = [
    pickTarget({ title: 'A', devpostUrl: 'd/a', links: ['https://a.example', 'https://github.com/a/a'] }),
    pickTarget({ title: 'B', devpostUrl: 'd/b', links: ['https://b.example', 'https://b2.example'] }),
    pickTarget({ title: 'C', devpostUrl: 'd/c', links: ['https://github.com/c/c'] }),
  ];
  const harvest = toHarvest(picks, { source: 'https://webmcp.devpost.com/project-gallery', harvestedAt: 'now' });

  assert.equal(harvest.counts.projects, 3);
  assert.equal(harvest.counts.usable, 2);
  assert.equal(harvest.counts.skipped, 1);
  assert.equal(harvest.counts.ambiguous, 1, 'B offered two demo links');
  assert.equal(harvest.counts.withRepo, 1);
  assert.deepEqual(harvest.targets[0], { project: 'A', url: 'https://a.example', repo: 'https://github.com/a/a' });
  assert.equal(harvest.skipped[0].project, 'C');
  assert.deepEqual(harvest.ambiguous[0].alsoOffered, ['https://b2.example']);
});

test('an empty gallery harvests to an empty target list rather than a crash', () => {
  const harvest = toHarvest([], { source: 'x', harvestedAt: 'now' });
  assert.equal(harvest.counts.projects, 0);
  assert.deepEqual(harvest.targets, []);
});
