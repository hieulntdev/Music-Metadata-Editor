'use strict';

const AUDIO_EXTENSIONS = Object.freeze([
  '.flac', '.mp3', '.m4a', '.mp4', '.ogg', '.oga', '.opus', '.aif', '.aiff', '.wav'
]);

const WRITABLE_FIELDS = Object.freeze([
  'title', 'artist', 'album', 'albumArtist', 'genre', 'date',
  'trackNumber', 'trackTotal', 'discNumber', 'discTotal',
  'composer', 'comment', 'lyrics', 'syncedLyrics', 'musicBrainzRecordingId',
  'musicBrainzReleaseId', 'musicBrainzArtistId'
]);

const BATCH_OPERATIONS = Object.freeze(['KEEP', 'REPLACE', 'CLEAR']);
const MAX_ARTWORK_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_LENGTH = 10000;
const MAX_LYRICS_LENGTH = 200000;
const MAX_AUTO_MATCH_TRACKS = 50;
const MAX_BATCH_SAVE_TRACKS = 50;
const AUTO_MATCH_CONCURRENCY = 3;

module.exports = {
  AUDIO_EXTENSIONS,
  WRITABLE_FIELDS,
  BATCH_OPERATIONS,
  MAX_ARTWORK_BYTES,
  MAX_TEXT_LENGTH,
  MAX_AUTO_MATCH_TRACKS,
  MAX_BATCH_SAVE_TRACKS,
  AUTO_MATCH_CONCURRENCY,
  MAX_LYRICS_LENGTH
};
