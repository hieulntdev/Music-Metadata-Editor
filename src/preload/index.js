'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const subscribe = (channel, handler) => {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('musicApp', Object.freeze({
  app: Object.freeze({ status: () => invoke('app:status') }),
  settings: Object.freeze({ get: () => invoke('settings:get'), set: (patch) => invoke('settings:set', patch) }),
  output: Object.freeze({ pickFolder: () => invoke('output:pick-folder') }),
  library: Object.freeze({
    pickFiles: () => invoke('library:pick-files'),
    pickFolder: () => invoke('library:pick-folder'),
    scan: (request) => invoke('library:scan', request),
    list: () => invoke('library:list'),
    onRecordUpdated: (handler) => subscribe('library:record-updated', handler),
    onRefresh: (handler) => subscribe('library:refresh', handler)
  }),
  metadata: Object.freeze({
    get: (fileId) => invoke('metadata:get', { fileId }),
    markReviewed: (fileId) => invoke('metadata:mark-reviewed', { fileId }),
    preview: (request) => invoke('metadata:preview', request),
    save: (previewId) => invoke('metadata:save', { previewId })
  }),
  batch: Object.freeze({
    preview: (request) => invoke('batch:preview', request),
    save: (previewId) => invoke('batch:save', { previewId })
  }),
  artwork: Object.freeze({
    pick: () => invoke('artwork:pick'),
    stageRemote: (url) => invoke('artwork:stage-remote', { url })
  }),
  rename: Object.freeze({
    preview: (request) => invoke('rename:preview', request),
    apply: (previewId) => invoke('rename:apply', { previewId })
  }),
  match: Object.freeze({
    search: (request) => invoke('match:search', request),
    startBatch: (fileIds) => invoke('match:batch-start', { fileIds }),
    fingerprint: (fileId) => invoke('match:fingerprint', { fileId }),
    coverUrl: (releaseId) => invoke('match:cover-url', { releaseId })
  }),
  jobs: Object.freeze({
    cancel: (jobId) => invoke('jobs:cancel', { jobId }),
    onProgress: (handler) => subscribe('jobs:progress', handler)
  }),
  system: Object.freeze({ openPath: (fileId) => invoke('system:open-path', { fileId }) }),
  events: Object.freeze({
    onWorkerStatus: (handler) => subscribe('worker:status', handler),
    onWorkerEvent: (handler) => subscribe('worker:event', handler),
    onDiagnostic: (handler) => subscribe('worker:diagnostic', handler)
  })
}));
