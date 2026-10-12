'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { similarity } = require('./musicbrainz.service');

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function artists(value) {
  if (Array.isArray(value)) return value.map(cleanString).filter(Boolean);
  const single = cleanString(value);
  return single ? [single] : [];
}

function normalizeCandidate(input, trackId, provider) {
  const sourceId = cleanString(input?.sourceId ?? input?.id);
  return {
    trackId,
    source: provider.displayName,
    sources: [provider.displayName],
    sourceId,
    title: cleanString(input?.title),
    artist: artists(input?.artist),
    album: cleanString(input?.album),
    duration: cleanNumber(input?.duration ?? input?.durationSeconds),
    releaseDate: cleanString(input?.releaseDate ?? input?.date),
    trackNumber: cleanNumber(input?.trackNumber),
    discNumber: cleanNumber(input?.discNumber),
    genre: cleanString(input?.genre),
    artworkUrl: cleanString(input?.artworkUrl),
    releaseId: cleanString(input?.releaseId),
    musicBrainzRecordingId: cleanString(input?.musicBrainzRecordingId),
    providerConfidence: cleanNumber(input?.providerConfidence),
    matchScore: null,
    provenance: [{ source: provider.displayName, sourceId }]
  };
}

function comparable(value) {
  return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function calculateMatchScore(record, candidate, options = {}) {
  const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const parts = [];
  const addSimilarity = (local, remote, weight) => {
    if (comparable(local) && comparable(remote)) parts.push([similarity(local, remote), weight]);
  };
  addSimilarity(metadata.title, candidate?.title, 40);
  addSimilarity(artists(metadata.artist).join(' '), artists(candidate?.artist).join(' '), 25);
  addSimilarity(metadata.album, candidate?.album, 15);
  const localDuration = cleanNumber(record?.durationSeconds);
  const remoteDuration = cleanNumber(candidate?.duration);
  if (localDuration !== null && remoteDuration !== null && localDuration > 0 && remoteDuration > 0) {
    const difference = Math.abs(localDuration - remoteDuration);
    parts.push([Math.max(0, 1 - difference / 30), 15]);
  }
  const localTrack = cleanNumber(metadata.trackNumber);
  const remoteTrack = cleanNumber(candidate?.trackNumber);
  if (localTrack !== null && remoteTrack !== null) parts.push([localTrack === remoteTrack ? 1 : 0, 5]);
  if (!parts.length) return 0;
  let score = parts.reduce((total, [value, weight]) => total + value * weight, 0);
  if (Number.isFinite(options.fingerprintConfidence)) {
    score = score * 0.8 + Math.max(0, Math.min(1, options.fingerprintConfidence)) * 20;
  }
  return Math.round(Math.max(0, Math.min(100, score)));
}

function duplicateKey(candidate) {
  const title = comparable(candidate.title);
  const artist = comparable(artists(candidate.artist).join(' '));
  const album = comparable(candidate.album);
  if (!title || !artist) return `${candidate.source}:${candidate.sourceId || title}:${album}`;
  return `${title}|${artist}|${album}`;
}

function mergeCandidates(candidates) {
  const merged = new Map();
  for (const candidate of candidates) {
    const key = duplicateKey(candidate);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...candidate, sources: [...candidate.sources], provenance: [...candidate.provenance] });
      continue;
    }
    const primary = candidate.matchScore > current.matchScore ? candidate : current;
    const sources = [...new Set([...current.sources, ...candidate.sources])];
    const provenance = [...current.provenance];
    for (const item of candidate.provenance) {
      if (!provenance.some((existing) => existing.source === item.source && existing.sourceId === item.sourceId)) provenance.push(item);
    }
    merged.set(key, { ...primary, source: sources.join(', '), sources, provenance });
  }
  return [...merged.values()].sort((left, right) => right.matchScore - left.matchScore || left.source.localeCompare(right.source)).slice(0, 24);
}

class HttpMetadataProvider {
  constructor({ providerId, displayName, minInterval = 250, timeout = 12000, retries = 2, fetchImpl = globalThis.fetch }) {
    this.providerId = providerId;
    this.displayName = displayName;
    this.minInterval = minInterval;
    this.timeout = timeout;
    this.retries = retries;
    this.fetchImpl = fetchImpl;
    this.lastRequest = 0;
    this.queue = Promise.resolve();
  }

  isAvailable() { return { available: true }; }
  lookupTrack() { return Promise.resolve(null); }
  normalizeResult(input, trackId) { return normalizeCandidate(input, trackId, this); }

  requestJson(url, { signal, headers = {} } = {}) {
    const task = this.queue.then(async () => {
      const wait = Math.max(0, this.minInterval - (Date.now() - this.lastRequest));
      if (wait) await delay(wait, undefined, { signal });
      let lastError;
      for (let attempt = 0; attempt <= this.retries; attempt += 1) {
        try {
          this.lastRequest = Date.now();
          const timeout = AbortSignal.timeout(this.timeout);
          const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
          const response = await this.fetchImpl(url, { signal: combined, headers: { Accept: 'application/json', ...headers } });
          if (response.ok) return response.json();
          const error = new Error(`${this.displayName} returned HTTP ${response.status}.`);
          error.code = response.status === 429 ? 'RATE_LIMIT' : response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'NETWORK_ERROR';
          if (response.status !== 429 && response.status < 500) throw error;
          lastError = error?.name === 'TimeoutError'
            ? Object.assign(new Error(`${this.displayName} request timed out.`), { code: 'PROVIDER_TIMEOUT' })
            : error;
        } catch (error) {
          if (signal?.aborted) throw error;
          lastError = error;
          if (error?.code === 'NETWORK_ERROR') throw error;
        }
        if (attempt < this.retries) await delay(500 * (2 ** attempt), undefined, { signal });
      }
      const error = lastError || new Error(`${this.displayName} request failed.`);
      if (!error.code) error.code = error?.name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE';
      throw error;
    });
    this.queue = task.catch(() => {});
    return task;
  }
}

class MusicBrainzProvider {
  constructor(service) { this.service = service; this.providerId = 'musicbrainz'; this.displayName = 'MusicBrainz'; }
  isAvailable() { return { available: true }; }
  lookupTrack() { return Promise.resolve(null); }
  normalizeResult(input, trackId) { return normalizeCandidate(input, trackId, this); }
  async searchTrack(record, context) {
    const metadata = record?.metadata || {};
    if (![metadata.title, ...(metadata.artist || []), metadata.album].some(Boolean)) return [];
    const values = await this.service.search(record, {}, context);
    return values.map((item) => ({
      sourceId: item.id, title: item.title, artist: item.artist, album: item.album,
      duration: item.durationSeconds, releaseDate: item.date, releaseId: item.releaseId,
      musicBrainzRecordingId: item.id,
      artworkUrl: item.releaseId ? this.service.coverArtUrl(item.releaseId) : null
    }));
  }
}

class ITunesProvider extends HttpMetadataProvider {
  constructor(options = {}) { super({ providerId: 'itunes', displayName: 'iTunes', minInterval: 3000, ...options }); }
  async searchTrack(record, context = {}) {
    const metadata = record?.metadata || {};
    const query = [metadata.title, ...artists(metadata.artist), metadata.album].filter(Boolean).join(' ');
    if (!query) return [];
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=8`;
    const data = await this.requestJson(url, context);
    return (Array.isArray(data?.results) ? data.results : []).map((item) => ({
      sourceId: String(item.trackId || ''), title: item.trackName, artist: item.artistName,
      album: item.collectionName, duration: Number(item.trackTimeMillis) / 1000,
      releaseDate: item.releaseDate, trackNumber: item.trackNumber, discNumber: item.discNumber,
      genre: item.primaryGenreName, artworkUrl: item.artworkUrl100
    }));
  }
}

class DeezerProvider extends HttpMetadataProvider {
  constructor(options = {}) { super({ providerId: 'deezer', displayName: 'Deezer', minInterval: 350, ...options }); }
  async searchTrack(record, context = {}) {
    const metadata = record?.metadata || {};
    const query = [metadata.title, ...artists(metadata.artist), metadata.album].filter(Boolean).join(' ');
    if (!query) return [];
    const data = await this.requestJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=8`, context);
    return (Array.isArray(data?.data) ? data.data : []).map((item) => ({
      sourceId: String(item.id || ''), title: item.title, artist: item.artist?.name,
      album: item.album?.title, duration: item.duration, trackNumber: item.track_position,
      artworkUrl: item.album?.cover_xl || item.album?.cover_big
    }));
  }
}

class DiscogsProvider extends HttpMetadataProvider {
  constructor(getSettings, options = {}) {
    super({ providerId: 'discogs', displayName: 'Discogs', minInterval: 1100, ...options });
    this.getSettings = getSettings;
  }
  isAvailable() {
    return this.getSettings()?.discogsToken
      ? { available: true }
      : { available: false, reason: 'Discogs token is not configured.' };
  }
  async searchTrack(record, context = {}) {
    const token = this.getSettings()?.discogsToken;
    if (!token) return [];
    const metadata = record?.metadata || {};
    const parameters = new URLSearchParams({ type: 'release', per_page: '8' });
    if (metadata.title) parameters.set('track', metadata.title);
    if (artists(metadata.artist).length) parameters.set('artist', artists(metadata.artist).join(' '));
    if (metadata.album) parameters.set('release_title', metadata.album);
    if (![...parameters.keys()].some((key) => !['type', 'per_page'].includes(key))) return [];
    const data = await this.requestJson(`https://api.discogs.com/database/search?${parameters}`, {
      ...context, headers: { Authorization: `Discogs token=${token}`, 'User-Agent': 'MusicMetadataEditor/1.0' }
    });
    return (Array.isArray(data?.results) ? data.results : []).map((item) => {
      const text = cleanString(item.title) || '';
      const separator = text.indexOf(' - ');
      return {
        sourceId: String(item.id || ''),
        title: null,
        artist: separator > 0 ? text.slice(0, separator) : (item.artist || null),
        album: separator > 0 ? text.slice(separator + 3) : text,
        releaseDate: item.year ? String(item.year) : null,
        genre: Array.isArray(item.genre) ? item.genre[0] : null,
        artworkUrl: item.cover_image
      };
    });
  }
}

class MetadataMatchService {
  constructor({ musicBrainz, getSettings, providers } = {}) {
    this.getSettings = getSettings || (() => ({}));
    this.providers = providers || [
      new MusicBrainzProvider(musicBrainz),
      new ITunesProvider(),
      new DeezerProvider(),
      new DiscogsProvider(this.getSettings)
    ];
  }

  providerStatuses() {
    const statuses = this.providers.map((provider) => ({
      providerId: provider.providerId, displayName: provider.displayName, ...provider.isAvailable()
    }));
    const settings = this.getSettings() || {};
    statuses.push({
      providerId: 'acoustid', displayName: 'AcoustID', mode: 'fingerprint',
      available: Boolean(settings.acoustIdApiKey),
      reason: settings.acoustIdApiKey ? null : 'AcoustID API key is not configured.'
    });
    return statuses;
  }

  async searchTrack(record, { signal } = {}) {
    const trackId = String(record?.fileId || '');
    const available = this.providers.filter((provider) => provider.isAvailable().available);
    const settled = await Promise.allSettled(available.map(async (provider) => {
      const raw = await provider.searchTrack(record, { signal });
      return raw.map((item) => {
        const candidate = provider.normalizeResult(item, trackId);
        candidate.matchScore = calculateMatchScore(record, candidate);
        return candidate;
      });
    }));
    if (signal?.aborted) throw Object.assign(new Error('Metadata matching was cancelled.'), { name: 'AbortError', code: 'ABORT_ERR' });
    const candidates = [];
    const providerErrors = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') candidates.push(...result.value);
      else providerErrors.push({
        providerId: available[index].providerId,
        source: available[index].displayName,
        code: result.reason?.code || 'PROVIDER_ERROR',
        message: result.reason?.message || `${available[index].displayName} failed.`
      });
    });
    return { fileId: trackId, candidates: mergeCandidates(candidates), providerErrors, providerCount: available.length };
  }
}

module.exports = {
  MetadataMatchService, MusicBrainzProvider, ITunesProvider, DeezerProvider, DiscogsProvider,
  normalizeCandidate, calculateMatchScore, mergeCandidates
};
