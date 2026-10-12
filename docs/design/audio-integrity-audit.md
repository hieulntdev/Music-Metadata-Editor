# Metadata Processing & Audio Integrity Audit

Audit date: 2026-10-12

## A. Metadata processing audit

### Supported formats found in source

| Extensions | Detected family | Read | Metadata/artwork write |
|---|---|---:|---:|
| `.flac` | FLAC | Yes | Yes |
| `.mp3` | MP3/ID3 | Yes | Yes |
| `.m4a`, `.mp4` | MP4 container (AAC or ALAC in tested audio files) | Yes | Yes |
| `.ogg`, `.oga` | Ogg Vorbis | Yes | Yes |
| `.opus` | Ogg Opus | Yes | Yes |
| `.aif`, `.aiff` | AIFF/ID3 | Yes | Yes |
| `.wav` | WAV | Yes | No; deliberately read-only |

Classification is based on the object returned by Mutagen, except WAV which is explicitly recognized by extension. An unrecognized or invalid container fails instead of being written.

### Modules and flows reviewed

- `src/renderer/components/app.js`: manual edits, batch edits, artwork staging, and multi-provider metadata selections remain drafts until Preview & Save.
- `src/main/index.js`: validates fields and file IDs, builds previews, serializes batch saves through the job manager, and sends all writes to the Python worker.
- `src/main/services/musicbrainz.service.js`: fetches suggestions only. MusicBrainz does not write files directly.
- `src/main/services/metadata-match.service.js`: queries isolated MusicBrainz, iTunes, Deezer, and optional Discogs providers, normalizes and scores candidates, and retains source provenance. It has no file-write capability.
- `src/main/jobs/job-manager.js`: keeps metadata-save jobs serial while allowing bounded-concurrency, abortable Auto Match search jobs. Cancel stops queued save work after the current atomic write.
- `backend/worker.py`: validates canonical source/Output paths and pre-save file signatures, checks again for conflicts immediately before copying, and invokes the shared writer.
- `backend/metadata/formats.py`: reads and patches canonical fields and artwork through Mutagen. It does not decode or encode audio.
- `backend/metadata/integrity.py`: isolates and hashes immutable encoded audio/media payload according to the container.

There is no FFmpeg invocation in the production metadata path. The only production subprocess is optional `fpcalc`, used read-only for Chromaprint matching. FFmpeg is used only by tests to generate valid fixtures and independently decode PCM for comparison.

### Current write transaction

1. Require and canonicalize the user-selected Output Folder; reject overlap with source/import roots and symlink aliases.
2. Check the scanned source file size and nanosecond modification time.
3. Preflight existing destinations and duplicate basenames without overwriting them.
4. Read codec properties and calculate a container-aware SHA-256 from the source audio payload.
5. Copy the source to a uniquely named temporary file inside Output.
6. Patch only requested metadata/artwork on the temporary copy with Mutagen.
7. Read back and verify every requested field and artwork operation.
8. Recalculate audio SHA-256 and compare codec, sample rate, bit depth, bitrate, duration, and channels.
9. Recheck the source identity, flush the candidate, and atomically publish a new Output file with no-overwrite semantics.
10. On any failure, remove the temporary file and leave both the source and any pre-existing Output file untouched.

## B. Audio quality assessment

| Family | Re-encoding in metadata path | Integrity method | Result on real valid fixture |
|---|---:|---|---|
| FLAC | No | SHA-256 of bytes after FLAC metadata blocks (encoded FLAC frames) | Passed |
| MP3 | No | SHA-256 of MPEG frame region excluding leading ID3v2 and trailing ID3v1/APEv2 | Passed |
| M4A/MP4 AAC | No | SHA-256 of all `mdat` payload bytes | Passed |
| M4A ALAC | No | SHA-256 of all `mdat` payload bytes | Passed |
| Ogg Vorbis | No | SHA-256 of identification/setup and exact audio packets, excluding only the comment packet | Passed |
| Ogg Opus | No | SHA-256 of `OpusHead` and exact audio packets, excluding only `OpusTags` | Passed |
| AIFF | No | SHA-256 of sample bytes in `SSND`, respecting its data offset | Passed |
| WAV | Not applicable; writes blocked | Parser supports SHA-256 of RIFF `data`, but no metadata write is allowed | Read-only behavior passed |

All writable format fixtures also passed an independent decoded-PCM SHA-256 comparison through FFmpeg. Both sides use the same explicit `s16le` normalization with no resampling, so this is only a secondary equivalence check; encoded-payload equality is the primary bit-perfect evidence.

For MP4, `mdat` may contain more than audio in a multiplexed `.mp4`. Hashing the complete `mdat` is stronger for preservation of all media payload, but the reported digest is intentionally described as a media-payload digest rather than an audio-only sample-table extraction. Tested `.m4a`/`.mp4` fixtures were audio-only AAC or ALAC.

## C. Issues found and fixes

1. **No bit-perfect post-write verification (high risk).** Metadata was read back, but audio payload was not checked. Added a fail-closed container-aware integrity verifier and technical-property comparison around every write.
2. **Direct in-place source mutation (high risk on interruption).** Mutagen previously saved directly to the original file. Sources are now read-only inputs; writes occur only on a temporary Output copy and publish a new file after verification.
3. **Verification happened after source replacement (medium risk).** A field serialization mismatch could previously be discovered only after the original had already changed. Field and artwork verification now occurs on the candidate before commit.
4. **OGG/Opus artwork replace/remove failed (functional bug).** Mutagen's Vorbis comment object does not accept `pop(key, default)`. The implementation now performs a compatible keyed delete.
5. **Editing ID3 Comment/Lyrics removed unrelated variants (metadata-loss bug).** The old code deleted every `COMM` or `USLT` frame. It now replaces only the canonical English/empty-description frame managed by the app and retains other languages/descriptions.
6. **Small conflict-check race window (medium risk).** Added canonical Output revalidation and an inode/size/mtime identity check immediately before no-overwrite publication.

No path that changes metadata invokes audio conversion, changes codec settings, or calls FFmpeg.

## D. Test results

Executed with Mutagen 1.47.0 and FFmpeg 9.0.2:

- Python suite: **26 passed, 0 failed, 0 skipped**.
- Node/Electron logic suite: **40 passed, 0 failed**.
- Encoded audio integrity: passed for FLAC, MP3, AAC/M4A, ALAC/M4A, AAC/MP4, Ogg Vorbis, Opus, and AIFF.
- Decoded PCM integrity: passed for the same writable format matrix.
- Metadata fields: every canonical field, including MusicBrainz IDs, passed write/readback and repeated-save checks.
- Artwork: replace and remove passed on every writable family; metadata-only edits retained multiple FLAC artworks.
- Unknown tags: custom FLAC field and non-canonical ID3 Comment/Lyrics variants were retained.
- Batch/concurrency: concurrent distinct-file Output writes passed while every source full-file SHA-256 stayed unchanged.
- Output safety: missing Output, existing destinations, duplicate basenames, source overlap, canonical symlink overlap, and a changed Output path are rejected without overwrite.
- Error handling: read-only source, invalid audio, injected copy/write failure, insufficient-space error, and injected integrity mismatch left the original untouched and no partial Output.
- Rename: the renamed-copy flow passed full-file SHA-256 verification and retained the original path and bytes.
- Renderer smoke: passed at 1620×928, 1440×900, 1180×780, and 900×650 with the Output picker present.

### Limits / not tested

- Fixtures are real, valid audio containers generated locally, but the audit did not run against a broad corpus of files from different encoders or a user's production music library.
- Sudden OS crash/power loss cannot be fully simulated in unit tests. Pre-publish failures are injected and tested; same-filesystem no-overwrite publication plus file/directory flush is implemented to reduce this risk.
- Exotic MP3 trailing tag schemes beyond ID3v1/APEv2, chained/multiplexed Ogg edge cases, fragmented MP4, compressed AIFF-C variants, and files near filesystem size limits were not independently corpus-tested. The writer fails closed when the verifier cannot safely isolate a supported payload.
- Network calls to MusicBrainz/Cover Art Archive were not exercised in the integrity suite. They only stage draft values/artwork; the eventual save uses the same fully tested writer.
- Atomic no-overwrite publication uses a same-directory hard link followed by temporary-name removal. Filesystems that do not support hard links will fail closed with `PUBLISH_FAILED`; a cross-filesystem copy is never attempted because the temporary file is created inside Output.
