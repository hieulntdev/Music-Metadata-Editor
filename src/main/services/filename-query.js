'use strict';

function filenameFromPath(filePath) {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

function compact(value) {
  return String(value || '').normalize('NFC').replace(/[_]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function unique(values) {
  return [...new Set(values.map(compact).filter(Boolean))];
}

const VERSION_PATTERN = /\b(live(?:\s+version)?|remix|mix|edit|cover|instrumental|acoustic|radio\s+edit|extended(?:\s+mix)?|demo|karaoke|remaster(?:ed)?(?:\s+\d{4})?)\b/iu;
const NOISE_PATTERN = /^\s*(?:official\s+)?(?:audio|music\s+video|mv|video|lyric(?:s|\s+video)?|visuali[sz]er)\s*$/iu;

function parseFilename(filePath) {
  const filename = filenameFromPath(filePath);
  const stemSource = filename.replace(/\.[^.]+$/u, '');
  const stem = compact(stemSource);
  const details = { filename, stem, album: null, composer: null, featuring: [], version: null, queries: [] };
  if (!stem) return details;

  let working = compact(stemSource.replace(/_+/gu, ' - '));
  working = working.replace(/\[([^\]]+)\]/gu, (whole, content) => {
    const value = compact(content);
    const album = value.match(/^album\s*(?::|=|-)?\s*(.+)$/iu);
    const composer = value.match(/^composer\s*(?::|=|-)?\s*(.+)$/iu);
    if (album) { details.album = compact(album[1]); return ' '; }
    if (composer) { details.composer = compact(composer[1]); return ' '; }
    if (NOISE_PATTERN.test(value)) return ' ';
    if (VERSION_PATTERN.test(value)) { details.version = value; return ' '; }
    return whole;
  });

  working = working.replace(/\(([^)]+)\)/gu, (whole, content) => {
    const value = compact(content);
    const featuring = value.match(/^(?:feat(?:uring)?|ft)\.?\s+(.+)$/iu);
    const album = value.match(/^album\s*(?::|=|-)?\s*(.+)$/iu);
    const composer = value.match(/^composer\s*(?::|=|-)?\s*(.+)$/iu);
    if (featuring) { details.featuring.push(compact(featuring[1])); return ' '; }
    if (album) { details.album = compact(album[1]); return ' '; }
    if (composer) { details.composer = compact(composer[1]); return ' '; }
    if (NOISE_PATTERN.test(value)) return ' ';
    if (VERSION_PATTERN.test(value)) { details.version = value; return ' '; }
    return whole;
  });

  working = working.replace(/\s+(?:feat(?:uring)?|ft)\.?\s+(.+)$/iu, (_whole, featured) => {
    details.featuring.push(compact(featured));
    return ' ';
  });

  working = compact(working.replace(/\s+[–—]\s+/gu, ' - '));
  const segments = working.split(/\s+-\s+/u).map(compact).filter(Boolean);
  const queryCandidates = [];
  const addQuery = (title, artist = []) => {
    const cleanTitle = compact(title);
    if (!cleanTitle) return;
    const metadata = {
      title: details.version ? `${cleanTitle} (${details.version})` : cleanTitle,
      artist: unique([...artist, ...details.featuring]),
      album: details.album,
      composer: details.composer ? [details.composer] : []
    };
    queryCandidates.push(metadata);
  };

  if (segments.length > 1 && segments.slice(1).every((value) => VERSION_PATTERN.test(value))) {
    details.version = compact(segments.slice(1).join(' '));
    addQuery(segments[0]);
  } else if (segments.length > 1) {
    const first = segments[0];
    const remainder = compact(segments.slice(1).join(' - '));
    addQuery(remainder, [first]);
    addQuery(first, [remainder]);
    addQuery(working);
  } else {
    addQuery(segments[0] || working);
  }

  const seen = new Set();
  details.queries = queryCandidates.filter((metadata) => {
    const key = JSON.stringify([metadata.title, metadata.artist, metadata.album]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
  return details;
}

module.exports = { filenameFromPath, parseFilename };
