'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { similarity, rankCandidate, candidatesFromAcoustId } = require('../../src/main/services/musicbrainz.service');

test('similarity normalizes punctuation and case', () => {
  assert.equal(similarity('A New Beginning!', 'a new beginning'), 1);
});

test('candidate ranking favors matching title and artist', () => {
  const record = { metadata: { title: 'Song', artist: ['Artist'], album: 'Album' }, durationSeconds: 180 };
  const strong = { title: 'Song', 'artist-credit': [{ name: 'Artist' }], length: 180000, releases: [{ title: 'Album' }] };
  const weak = { title: 'Different', 'artist-credit': [{ name: 'Other' }], length: 250000, releases: [] };
  assert.ok(rankCandidate(record, strong) > rankCandidate(record, weak));
});

test('AcoustID results become sorted, de-duplicated MusicBrainz candidates', () => {
  const candidates = candidatesFromAcoustId({ results: [
    { score: 0.7, recordings: [{ id: 'recording-1', title: 'First', artists: [{ name: 'Artist' }], releasegroups: [{ title: 'Album' }] }] },
    { score: 0.95, recordings: [{ id: 'recording-2', title: 'Second', artists: [{ name: 'Other' }] }] },
    { score: 0.8, recordings: [{ id: 'recording-1', title: 'First', artists: [{ name: 'Artist' }] }] }
  ] });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].id, 'recording-2');
  assert.equal(candidates[1].score, 80);
  assert.equal(candidates[1].artist[0], 'Artist');
});
