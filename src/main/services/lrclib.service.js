'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { parseFilename } = require('./filename-query');

const LRCLIB_BASE_URL = 'https://lrclib.net';
const VERSION_WORDS = Object.freeze(['live', 'remix', 'mix', 'edit', 'acoustic', 'cover', 'instrumental', 'karaoke', 'demo', 'remaster']);

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function artistText(value) { return Array.isArray(value) ? value.filter(Boolean).join(' ') : text(value) || ''; }

function comparable(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function similarity(left, right) {
  const a = comparable(left); const b = comparable(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = new Set(a.split(' ')); const bb = new Set(b.split(' '));
  const intersection = [...aa].filter((token) => bb.has(token)).length;
  const union = new Set([...aa, ...bb]).size;
  const tokenScore = union ? intersection / union : 0;
  const prefix = a.startsWith(b) || b.startsWith(a) ? Math.min(a.length, b.length) / Math.max(a.length, b.length) : 0;
  return Math.max(tokenScore, prefix * 0.95);
}

function versionTokens(value) {
  const normalized = comparable(value);
  return new Set(VERSION_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, 'u').test(normalized)));
}

function normalizeRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = Number(input.id);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return {
    id,
    trackName: text(input.trackName ?? input.name), artistName: text(input.artistName),
    albumName: text(input.albumName), duration: number(input.duration),
    instrumental: input.instrumental === true,
    plainLyrics: typeof input.plainLyrics === 'string' ? input.plainLyrics : null,
    syncedLyrics: typeof input.syncedLyrics === 'string' ? input.syncedLyrics : null
  };
}

function scoreCandidate(metadata, durationSeconds, candidate) {
  const titleScore = similarity(metadata?.title, candidate?.trackName);
  const artistScore = similarity(artistText(metadata?.artist), candidate?.artistName);
  const albumKnown = Boolean(comparable(metadata?.album) && comparable(candidate?.albumName));
  const albumScore = albumKnown ? similarity(metadata.album, candidate.albumName) : 0;
  const localDuration = number(durationSeconds); const remoteDuration = number(candidate?.duration);
  const durationKnown = localDuration > 0 && remoteDuration > 0;
  const durationDifference = durationKnown ? Math.abs(localDuration - remoteDuration) : null;
  const durationScore = durationKnown ? Math.max(0, 1 - durationDifference / 30) : 0;
  const localVersions = versionTokens(metadata?.title); const remoteVersions = versionTokens(candidate?.trackName);
  const versionMismatch = [...new Set([...localVersions, ...remoteVersions])]
    .some((word) => localVersions.has(word) !== remoteVersions.has(word));
  const evidence = [[titleScore, 45, Boolean(comparable(metadata?.title) && comparable(candidate?.trackName))],
    [artistScore, 30, Boolean(comparable(artistText(metadata?.artist)) && comparable(candidate?.artistName))],
    [albumScore, 10, albumKnown], [durationScore, 15, durationKnown]];
  const availableWeight = evidence.filter((part) => part[2]).reduce((sum, part) => sum + part[1], 0);
  let score = availableWeight ? evidence.reduce((sum, [value, weight, known]) => sum + (known ? value * weight : 0), 0) : 0;
  // Missing evidence must not be normalized into false certainty.
  if (availableWeight < 75) score = Math.min(score, 79);
  if (versionMismatch) score = Math.min(score, 59);
  score = Math.round(Math.max(0, Math.min(100, score)));
  let confidence = score >= 85 && titleScore >= 0.9 && artistScore >= 0.85 && !versionMismatch ? 'high'
    : score >= 65 && !versionMismatch ? 'medium' : 'low';
  if (durationDifference !== null && durationDifference > 12) confidence = confidence === 'high' ? 'medium' : 'low';
  const reasons = [];
  if (titleScore < 0.75) reasons.push('title differs');
  if (artistScore < 0.75) reasons.push('artist differs');
  if (versionMismatch) reasons.push('version/edit differs');
  if (durationDifference !== null && durationDifference > 2) reasons.push(`duration differs by ${Math.round(durationDifference)}s`);
  if (!reasons.length) reasons.push(confidence === 'high' ? 'title, artist and available context agree' : 'some matching evidence is missing');
  return { ...candidate, score, confidence, matchReason: reasons.join('; '), versionMismatch, durationDifference };
}

function validateLrc(value) {
  if (!value) return { valid: true, errors: [] };
  const errors = []; let previous = -1; let timedLines = 0;
  String(value).split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim() || /^\[(?:ar|al|ti|au|by|length|offset|re):/iu.test(line.trim())) return;
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/gu)];
    if (!stamps.length) { errors.push({ line: index + 1, message: 'Missing or malformed timestamp.' }); return; }
    timedLines += 1;
    for (const match of stamps) {
      const seconds = Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`);
      if (Number(match[2]) >= 60 || !Number.isFinite(seconds)) errors.push({ line: index + 1, message: 'Invalid timestamp.' });
      else if (seconds < previous) errors.push({ line: index + 1, message: 'Timestamp is earlier than the previous line.' });
      previous = Math.max(previous, seconds);
    }
  });
  if (String(value).trim() && !timedLines && !errors.length) errors.push({ line: 0, message: 'No timestamped lyric line.' });
  return { valid: errors.length === 0, errors };
}

class LrclibError extends Error {
  constructor(code, message, details) { super(message); this.name = 'LrclibError'; this.code = code; this.details = details; }
}

class LrclibService {
  constructor({ fetchImpl = globalThis.fetch, userAgent = 'MusicMetadataEditor/1.0', minInterval = 350, timeout = 12000, retries = 2, random = Math.random } = {}) {
    this.fetchImpl = fetchImpl; this.userAgent = userAgent; this.minInterval = minInterval;
    this.timeout = timeout; this.retries = retries; this.random = random; this.lastRequest = 0;
    this.queue = Promise.resolve(); this.cache = new Map();
  }

  async request(pathname, parameters, { signal } = {}) {
    const url = new URL(pathname, LRCLIB_BASE_URL);
    for (const [key, value] of Object.entries(parameters || {})) if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
    const task = this.queue.then(async () => {
      if (signal?.aborted) throw Object.assign(new Error('Lyrics lookup was cancelled.'), { name: 'AbortError', code: 'ABORT_ERR' });
      const wait = Math.max(0, this.minInterval - (Date.now() - this.lastRequest));
      if (wait) await delay(wait, undefined, { signal });
      for (let attempt = 0; attempt <= this.retries; attempt += 1) {
        let phase = 'connect';
        try {
          this.lastRequest = Date.now();
          const timeoutSignal = AbortSignal.timeout(this.timeout);
          const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
          const response = await this.fetchImpl(url, { signal: combined, headers: { Accept: 'application/json', 'User-Agent': this.userAgent } });
          phase = 'read';
          if (response.status === 404) return { notFound: true, data: null };
          if (response.ok) {
            const type = response.headers?.get?.('content-type') || '';
            if (type && !type.includes('json')) throw new LrclibError('LRCLIB_INVALID_RESPONSE', 'LRCLIB returned a non-JSON response.');
            try { return { notFound: false, data: await response.json() }; }
            catch (error) {
              if (error?.name === 'TimeoutError') throw error;
              throw new LrclibError('LRCLIB_INVALID_RESPONSE', 'LRCLIB returned malformed JSON.');
            }
          }
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable) throw new LrclibError('LRCLIB_REQUEST_INVALID', `LRCLIB rejected the request (HTTP ${response.status}).`, { status: response.status });
          if (attempt >= this.retries) throw new LrclibError(response.status === 429 ? 'LRCLIB_RATE_LIMITED' : 'LRCLIB_UNAVAILABLE', `LRCLIB returned HTTP ${response.status}.`, { status: response.status });
          const retryHeader = response.headers?.get?.('retry-after');
          let retryMilliseconds = null;
          if (retryHeader && /^\d+(?:\.\d+)?$/u.test(retryHeader)) retryMilliseconds = Number(retryHeader) * 1000;
          else if (retryHeader) {
            const retryDate = Date.parse(retryHeader);
            if (Number.isFinite(retryDate)) retryMilliseconds = Math.max(0, retryDate - Date.now());
          }
          const backoff = retryMilliseconds !== null ? retryMilliseconds : Math.min(4000, 400 * (2 ** attempt)) + Math.round(this.random() * 200);
          await delay(backoff, undefined, { signal });
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw Object.assign(new Error('Lyrics lookup was cancelled.'), { name: 'AbortError', code: 'ABORT_ERR' });
          if (error instanceof LrclibError && !['LRCLIB_UNAVAILABLE', 'LRCLIB_RATE_LIMITED'].includes(error.code)) throw error;
          const timedOut = error?.name === 'TimeoutError';
          if (attempt >= this.retries) throw new LrclibError(timedOut ? (phase === 'connect' ? 'LRCLIB_CONNECT_TIMEOUT' : 'LRCLIB_READ_TIMEOUT') : error?.code || 'LRCLIB_NETWORK_ERROR', timedOut ? `LRCLIB ${phase} timed out.` : error?.message || 'LRCLIB request failed.');
          await delay(Math.min(4000, 400 * (2 ** attempt)) + Math.round(this.random() * 200), undefined, { signal });
        }
      }
      throw new LrclibError('LRCLIB_NETWORK_ERROR', 'LRCLIB request failed.');
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async lookup(record, metadataInput, { signal } = {}) {
    const metadata = metadataInput && typeof metadataInput === 'object' ? metadataInput : record?.metadata || {};
    const originalTitle = text(metadata.title); const originalArtist = artistText(metadata.artist);
    const parsed = (!originalTitle || !originalArtist) ? parseFilename(record?.absolutePath) : null;
    const guesses = parsed?.queries || [];
    const plans = originalTitle && originalArtist ? [{ metadata, inferred: false }]
      : guesses.filter((item) => text(item.title) && artistText(item.artist)).map((item) => ({ metadata: { ...metadata, ...item }, inferred: true }));
    if (!plans.length) return { fileId: record?.fileId, status: 'reviewRequired', candidates: [], matchBasis: 'insufficient-metadata', reason: 'Title and Artist are required; the filename did not contain a safe Artist - Title guess.' };
    const candidates = new Map(); let exact = null;
    for (const plan of plans.slice(0, 3)) {
      const title = text(plan.metadata.title); const artist = artistText(plan.metadata.artist); const album = text(plan.metadata.album);
      const duration = number(record?.durationSeconds);
      const exactParameters = { track_name: title, artist_name: artist, album_name: album, duration: duration > 0 && duration <= 3600 ? Math.round(duration) : null };
      const exactResponse = await this.cached('/api/get', exactParameters, { signal });
      if (!exactResponse.notFound) {
        const normalized = normalizeRecord(exactResponse.data);
        if (normalized) {
          const scored = scoreCandidate(plan.metadata, duration, normalized); candidates.set(scored.id, scored); exact = scored;
          if (!plan.inferred && scored.confidence === 'high' && (scored.instrumental || scored.plainLyrics || scored.syncedLyrics)) {
            return {
              fileId: record?.fileId, status: scored.instrumental ? 'instrumental' : 'found', outcome: scored.instrumental ? 'instrumental' : 'found',
              candidate: scored, candidates: [scored], matchBasis: 'metadata', reason: scored.matchReason
            };
          }
        }
      }
      const structured = await this.cached('/api/search', { track_name: title, artist_name: artist, album_name: album }, { signal });
      if (Array.isArray(structured.data)) for (const raw of structured.data) {
        const normalized = normalizeRecord(raw); if (!normalized) continue;
        const scored = scoreCandidate(plan.metadata, duration, normalized); const current = candidates.get(scored.id);
        if (!current || scored.score > current.score) candidates.set(scored.id, scored);
      }
      if (![...candidates.values()].some((item) => item.confidence !== 'low')) {
        const keyword = await this.cached('/api/search', { q: `${title} ${artist}` }, { signal });
        if (Array.isArray(keyword.data)) for (const raw of keyword.data) {
          const normalized = normalizeRecord(raw); if (!normalized) continue;
          const scored = scoreCandidate(plan.metadata, duration, normalized); const current = candidates.get(scored.id);
          if (!current || scored.score > current.score) candidates.set(scored.id, scored);
        }
      }
    }
    const sorted = [...candidates.values()].sort((a, b) => b.score - a.score || a.id - b.id);
    const best = exact?.confidence === 'high' ? exact : sorted[0] || null;
    if (!best) return { fileId: record?.fileId, status: 'notFound', outcome: 'notFound', candidates: [], matchBasis: parsed ? 'filename' : 'metadata' };
    const noLyrics = !best.instrumental && !best.plainLyrics && !best.syncedLyrics;
    const ambiguous = !exact && sorted[1] && best.score - sorted[1].score < 8;
    const status = best.instrumental ? 'instrumental' : noLyrics ? 'notFound' : best.confidence === 'high' && !ambiguous && !parsed ? 'found' : 'reviewRequired';
    return { fileId: record?.fileId, status, outcome: noLyrics ? 'foundWithoutLyrics' : best.instrumental ? 'instrumental' : 'found', candidate: best, candidates: sorted.slice(0, 20), matchBasis: parsed ? 'filename' : 'metadata', reason: noLyrics ? 'LRCLIB found the recording but it contains no Plain or Synced lyrics.' : ambiguous ? 'Top candidates are too close to choose safely.' : best.matchReason };
  }

  async cached(pathname, parameters, options) {
    if (options?.signal?.aborted) throw Object.assign(new Error('Lyrics lookup was cancelled.'), { name: 'AbortError', code: 'ABORT_ERR' });
    const key = `${pathname}?${new URLSearchParams(Object.entries(parameters).filter(([, value]) => value !== null && value !== undefined && value !== '')).toString()}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < 10 * 60 * 1000) return cached.value;
    const value = await this.request(pathname, parameters, options);
    this.cache.set(key, { time: Date.now(), value });
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
    return value;
  }
}

module.exports = { LrclibService, LrclibError, normalizeRecord, scoreCandidate, validateLrc, comparable };
