'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('../../shared/schemas');

function canonicalDirectory(folder) {
  if (typeof folder !== 'string' || !folder.trim()) {
    throw new AppError('OUTPUT_NOT_SELECTED', 'Choose an Output Folder before previewing or saving.');
  }
  let resolved;
  try {
    resolved = fs.realpathSync.native(path.resolve(folder));
  } catch {
    throw new AppError('OUTPUT_NOT_FOUND', 'The selected Output Folder no longer exists. Choose it again.');
  }
  let details;
  try { details = fs.statSync(resolved); }
  catch { throw new AppError('OUTPUT_NOT_FOUND', 'The selected Output Folder cannot be accessed.'); }
  if (!details.isDirectory()) throw new AppError('INVALID_OUTPUT_PATH', 'The selected Output path is not a folder.');
  try { fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK); }
  catch { throw new AppError('OUTPUT_NOT_WRITABLE', 'The selected Output Folder is not writable.'); }
  return resolved;
}

function canonicalExistingPath(value) {
  try { return fs.realpathSync.native(path.resolve(value)); }
  catch { return path.resolve(value); }
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathKey(value) {
  return path.resolve(value).normalize('NFC').toLocaleLowerCase('en-US');
}

function validateOutputFolder(folder, sourcePaths, protectedRoots = []) {
  const outputFolder = canonicalDirectory(folder);
  const sources = sourcePaths.map(canonicalExistingPath);
  const sourceFolders = sources.map((source) => path.dirname(source));
  const roots = [...protectedRoots, ...sourceFolders].map(canonicalExistingPath);

  for (const root of roots) {
    if (contains(root, outputFolder) || contains(outputFolder, root)) {
      throw new AppError(
        'OUTPUT_OVERLAPS_SOURCE',
        'Output Folder must be separate from every source folder and cannot contain, equal, or sit inside a source location.'
      );
    }
  }
  return outputFolder;
}

class OutputFolderSession {
  constructor() {
    this.folder = '';
  }

  get current() {
    return this.folder;
  }

  select(folder, sourcePaths = [], protectedRoots = []) {
    this.folder = validateOutputFolder(folder, sourcePaths, protectedRoots);
    return this.folder;
  }

  clear() {
    this.folder = '';
  }
}

function planOutputEntries(entries, folder, protectedRoots = [], nameForEntry = (entry) => path.basename(entry.path)) {
  const outputFolder = validateOutputFolder(folder, entries.map((entry) => entry.path), protectedRoots);
  const prepared = entries.map((entry) => {
    const fileName = nameForEntry(entry);
    if (path.basename(fileName) !== fileName || !fileName || fileName === '.' || fileName === '..') {
      throw new AppError('INVALID_OUTPUT_PATH', 'An output file name is invalid.');
    }
    const outputPath = path.join(outputFolder, fileName);
    const key = pathKey(outputPath);
    return { entry, outputPath, key };
  });
  const counts = new Map();
  for (const item of prepared) counts.set(item.key, (counts.get(item.key) || 0) + 1);
  return prepared.map(({ entry, outputPath, key }) => {
    const outputConflict = counts.get(key) > 1 ? 'DUPLICATE_OUTPUT' : fs.existsSync(outputPath) ? 'OUTPUT_EXISTS' : null;
    return {
      ...entry,
      outputFolder,
      outputPath,
      outputConflict,
      conflict: Boolean(entry.conflict || outputConflict)
    };
  });
}

module.exports = { OutputFolderSession, canonicalDirectory, contains, pathKey, planOutputEntries, validateOutputFolder };
