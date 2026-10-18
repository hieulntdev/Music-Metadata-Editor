# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-18

### Added

- Added LRCLIB lookup with precise, structured, keyword, and filename fallback searches, confidence scoring, review states, cancellation, and rate-limit handling.
- Added separate plain and synced lyrics editing, LRC timestamp validation, per-file lyrics drafts, and lyrics match review.
- Added embedded lyrics support for FLAC, Ogg, Opus, MP3, AIFF, M4A, and MP4, including Navidrome-compatible field mappings.
- Added optional external `.lrc` export beside generated Output copies, with conflict detection and no-overwrite safeguards.
- Added file-list pagination, filename and row-number columns, completed-state indicators, a Done filter, and sorting for the new columns.
- Added batch metadata Preview & Save for up to 50 tracks with per-file progress, cancellation, and output-conflict reporting.
- Added filename-aware metadata matching and richer per-track workflow states for matching, review, save, conflict, and completion.

### Changed

- Improved Auto Match with bounded concurrency, provider isolation, fallback queries, clearer candidate provenance, and more robust review handling.
- Improved table selection, default ordering, column sizing, responsive layouts, and large-library rendering.
- Improved worker startup and shutdown handling so pending work is rejected cleanly and owned Python processes are terminated reliably.
- Strengthened Output safety checks, atomic save verification, and preservation of encoded audio data and unrelated metadata.
- Expanded the layout smoke test to cover lyrics editing and review, batch save progress, pagination, and large result sets.

### Removed

- Removed the legacy tracked test suite and excluded local test artifacts from version control.
