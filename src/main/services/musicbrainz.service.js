'use strict';

const { setTimeout: delay } = require('node:timers/promises');

function normalized(value) {
  return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function similarity(left, right) {
  const a = new Set(normalized(left).split(' ').filter(Boolean));
  const b = new Set(normalized(right).split(' ').filter(Boolean));
  if (!a.size && !b.size) return 1;
  const common = [...a].filter((item) => b.has(item)).length;
  return common / Math.max(a.size, b.size, 1);
}

function rankCandidate(record, candidate) {
  const metadata = record.metadata || {};
  const artist = (metadata.artist || []).join(' ');
  const candidateArtist = (candidate['artist-credit'] || []).map((item) => item.name || item.artist?.name).join(' ');
  let score = similarity(metadata.title, candidate.title) * 45 + similarity(artist, candidateArtist) * 30;
  const length = Number(candidate.length || 0) / 1000;
  if (length && record.durationSeconds) score += Math.max(0, 15 - Math.abs(length - record.durationSeconds) / 2);
  const releases = candidate.releases || [];
  if (metadata.album && releases.some((release) => similarity(metadata.album, release.title) > 0.8)) score += 10;
  return Math.round(score);
}

function candidatesFromAcoustId(response) {
  const byRecording = new Map();
  for (const match of response?.results || []) {
    for (const recording of match?.recordings || []) {
      if (!recording?.id) continue;
      const artists = (recording.artists || []).map((artist) => artist?.name).filter(Boolean);
      const releaseGroup = (recording.releasegroups || recording.releaseGroups || [])[0];
      const candidate = {
        id: recording.id,
        title: recording.title || '',
        artist: artists,
        album: releaseGroup?.title || '',
        date: '',
        releaseId: '',
        score: Math.round(Math.max(0, Math.min(1, Number(match.score) || 0)) * 100),
        source: 'AcoustID / MusicBrainz'
      };
      const previous = byRecording.get(candidate.id);
      if (!previous || candidate.score > previous.score) byRecording.set(candidate.id, candidate);
    }
  }
  return [...byRecording.values()].sort((left, right) => right.score - left.score);
}

class MusicBrainzService {
  constructor() {
    this.lastRequest = 0;
    this.cache = new Map();
    this.requestQueue = Promise.resolve();
    this.userAgent = 'MusicMetadataEditor/1.0 (local desktop metadata utility)';
  }

  request(url, options = {}) {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.time < 24 * 60 * 60 * 1000) return Promise.resolve(cached.value);
    const request = this.requestQueue.then(() => this.requestNow(url, options));
    this.requestQueue = request.catch(() => {});
    return request;
  }

  async requestNow(url, options = {}) {
    const wait = Math.max(0, 1100 - (Date.now() - this.lastRequest));
    if (wait) await delay(wait, undefined, { signal: options.signal });
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.lastRequest = Date.now();
      try {
        const timeout = AbortSignal.timeout(15000);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        const response = await fetch(url, {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          signal
        });
        if (response.ok) {
          const value = await response.json();
          this.cache.set(url, { time: Date.now(), value });
          if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
          return value;
        }
        if (response.status !== 429 && response.status < 500) throw Object.assign(new Error(`MusicBrainz returned HTTP ${response.status}.`), { code: 'NETWORK_ERROR' });
        lastError = new Error(`MusicBrainz is temporarily unavailable (HTTP ${response.status}).`);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        lastError = error;
      }
      if (attempt < 2) await delay(600 * (2 ** attempt), undefined, { signal: options.signal });
    }
    throw Object.assign(lastError || new Error('MusicBrainz request failed.'), { code: 'NETWORK_TIMEOUT' });
  }

  async search(record, options = {}, context = {}) {
    const metadata = record.metadata || {};
    const clauses = [];
    const title = options.title || metadata.title;
    const artist = options.artist || (metadata.artist || []).join(' ');
    const album = options.album || metadata.album;
    if (title) clauses.push(`recording:${JSON.stringify(title)}`);
    if (artist) clauses.push(`artist:${JSON.stringify(artist)}`);
    if (album) clauses.push(`release:${JSON.stringify(album)}`);
    if (!clauses.length) throw Object.assign(new Error('Add a title, artist, or album before searching.'), { code: 'INVALID_REQUEST' });
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(clauses.join(' AND '))}&fmt=json&limit=8`;
    const data = await this.request(url, context);
    return (data.recordings || []).map((candidate) => {
      const release = candidate.releases?.[0];
      const artistNames = (candidate['artist-credit'] || []).map((item) => item.name || item.artist?.name).filter(Boolean);
      return {
        id: candidate.id,
        title: candidate.title || '',
        artist: artistNames,
        album: release?.title || '',
        date: release?.date || candidate['first-release-date'] || '',
        releaseId: release?.id || '',
        durationSeconds: candidate.length ? Math.round(candidate.length / 1000) : null,
        score: rankCandidate(record, candidate),
        source: 'MusicBrainz'
      };
    }).sort((a, b) => b.score - a.score);
  }

  coverArtUrl(releaseId) {
    if (!/^[0-9a-f-]{36}$/i.test(releaseId || '')) return null;
    return `https://coverartarchive.org/release/${releaseId}/front-500`;
  }
}

module.exports = { MusicBrainzService, similarity, rankCandidate, candidatesFromAcoustId };
