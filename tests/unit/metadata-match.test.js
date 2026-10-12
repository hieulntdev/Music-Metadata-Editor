'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MetadataMatchService, MusicBrainzProvider, ITunesProvider, DeezerProvider,
  normalizeCandidate, calculateMatchScore, mergeCandidates
} = require('../../src/main/services/metadata-match.service');

const provider = { displayName: 'Fixture' };

test('normalization preserves missing provider fields as null and supports Unicode metadata', () => {
  const candidate = normalizeCandidate({
    sourceId: '一', title: 'Trời hôm nay nhiều mây cực!', artist: ['宇多田ヒカル'], duration: null
  }, 'local-1', provider);
  assert.equal(candidate.duration, null);
  assert.equal(candidate.album, null);
  assert.equal(candidate.trackNumber, null);
  assert.equal(candidate.title, 'Trời hôm nay nhiều mây cực!');
  assert.deepEqual(candidate.artist, ['宇多田ヒカル']);
});

test('match score is normalized to 0-100 and incomplete evidence cannot look certain', () => {
  const record = { metadata: { title: 'Song', artist: ['Artist'], album: 'Album', trackNumber: '2' }, durationSeconds: 180 };
  const exact = normalizeCandidate({ title: 'Song', artist: 'Artist', album: 'Album', trackNumber: 2, duration: 180 }, 'track', provider);
  const durationOnly = normalizeCandidate({ duration: 180 }, 'track', provider);
  assert.equal(calculateMatchScore(record, exact), 100);
  assert.equal(calculateMatchScore(record, durationOnly), 15);
});

test('duplicate candidates merge sources while retaining complete provenance', () => {
  const first = { ...normalizeCandidate({ sourceId: 'mb-1', title: 'Song', artist: 'Artist', album: 'Album' }, 'track', { displayName: 'MusicBrainz' }), matchScore: 90 };
  const second = { ...normalizeCandidate({ sourceId: 'dz-1', title: 'song', artist: 'artist', album: 'album' }, 'track', { displayName: 'Deezer' }), matchScore: 92 };
  const merged = mergeCandidates([first, second]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'MusicBrainz, Deezer');
  assert.deepEqual(merged[0].sources, ['MusicBrainz', 'Deezer']);
  assert.deepEqual(merged[0].provenance, [
    { source: 'MusicBrainz', sourceId: 'mb-1' },
    { source: 'Deezer', sourceId: 'dz-1' }
  ]);
});

test('one provider failure does not discard successful provider candidates', async () => {
  const successful = {
    providerId: 'good', displayName: 'Good', isAvailable: () => ({ available: true }),
    normalizeResult(input, trackId) { return normalizeCandidate(input, trackId, this); },
    async searchTrack() { return [{ sourceId: '1', title: 'Song', artist: 'Artist' }]; }
  };
  const failing = {
    providerId: 'bad', displayName: 'Bad', isAvailable: () => ({ available: true }),
    normalizeResult(input, trackId) { return normalizeCandidate(input, trackId, this); },
    async searchTrack() { throw Object.assign(new Error('timed out'), { code: 'PROVIDER_TIMEOUT' }); }
  };
  const service = new MetadataMatchService({ providers: [failing, successful] });
  const result = await service.searchTrack({ fileId: 'track', metadata: { title: 'Song', artist: ['Artist'] } });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.providerCount, 2);
  assert.equal(result.candidates[0].source, 'Good');
  assert.deepEqual(result.providerErrors.map((item) => item.code), ['PROVIDER_TIMEOUT']);
});

test('iTunes provider maps real API fields without inventing absent values', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ results: [{
    trackId: 42, trackName: 'Track', artistName: 'Artist', collectionName: 'Release',
    trackTimeMillis: 201000, releaseDate: '2025-01-01T00:00:00Z', trackNumber: 3,
    primaryGenreName: 'Pop', artworkUrl100: 'https://example.invalid/art.jpg'
  }] }) });
  const service = new ITunesProvider({ fetchImpl, minInterval: 0, retries: 0 });
  const [result] = await service.searchTrack({ metadata: { title: 'Track', artist: ['Artist'] } });
  assert.equal(result.sourceId, '42');
  assert.equal(result.duration, 201);
  assert.equal(result.discNumber, undefined);
});

test('a duration-only track safely returns no metadata query instead of throwing', async () => {
  let requests = 0;
  const musicBrainz = new MusicBrainzProvider({
    async search() { requests += 1; return []; },
    coverArtUrl() { return null; }
  });
  const fetchImpl = async () => { requests += 1; return { ok: true, json: async () => ({}) }; };
  const service = new MetadataMatchService({ providers: [
    musicBrainz,
    new ITunesProvider({ fetchImpl, minInterval: 0, retries: 0 }),
    new DeezerProvider({ fetchImpl, minInterval: 0, retries: 0 })
  ] });
  const result = await service.searchTrack({ fileId: 'duration-only', durationSeconds: 123, metadata: {} });
  assert.equal(requests, 0);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.providerErrors, []);
});

test('all-provider failure is observable separately from an empty search result', async () => {
  const failing = (providerId) => ({
    providerId, displayName: providerId, isAvailable: () => ({ available: true }),
    normalizeResult(input, trackId) { return normalizeCandidate(input, trackId, this); },
    async searchTrack() { throw Object.assign(new Error('offline'), { code: 'PROVIDER_UNAVAILABLE' }); }
  });
  const service = new MetadataMatchService({ providers: [failing('one'), failing('two')] });
  const result = await service.searchTrack({ fileId: 'track', metadata: { title: 'Song' } });
  assert.equal(result.providerCount, 2);
  assert.equal(result.providerErrors.length, 2);
  assert.deepEqual(result.candidates, []);
});
