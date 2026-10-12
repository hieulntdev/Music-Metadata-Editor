'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

class JobManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
  }

  create(type, items, processor, options = {}) {
    const id = crypto.randomUUID();
    const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 1));
    const itemStatuses = Object.fromEntries(items.map((item, index) => [this.itemKey(item, index), 'pending']));
    const job = {
      id, type, state: 'queued', total: items.length, processed: 0,
      saved: 0, skipped: 0, failed: 0, conflict: 0,
      matched: 0, noMatch: 0, cancelled: 0,
      currentFile: '', cancelRequested: false, errors: [], results: {}, itemStatuses,
      concurrency, startedAt: Date.now(), _controller: new AbortController()
    };
    Object.assign(job, options.publicData || {});
    this.jobs.set(id, job);
    queueMicrotask(() => this.run(job, items, processor));
    return this.public(job);
  }

  async run(job, items, processor) {
    job.state = 'running';
    this.emitUpdate(job);
    let nextIndex = 0;
    const runNext = async () => {
      while (!job.cancelRequested) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        const item = items[index];
        const key = this.itemKey(item, index);
        const currentFile = item.path || item.absolutePath || item.fileId || String(key);
        job.currentFile = currentFile;
        job.itemStatuses[key] = 'searching';
        this.emitUpdate(job);
        try {
          const result = await processor(item, job, { signal: job._controller.signal, index, key });
          const bucket = result?.status || 'saved';
          if (Object.hasOwn(job, bucket)) job[bucket] += 1;
          else job.saved += 1;
          job.itemStatuses[key] = bucket === 'noMatch' ? 'no-match' : bucket;
          if (result && Object.hasOwn(result, 'result')) job.results[key] = result.result;
        } catch (error) {
          if (job.cancelRequested || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
            job.cancelled += 1;
            job.itemStatuses[key] = 'cancelled';
          } else {
            const bucket = ['FILE_CHANGED', 'OUTPUT_EXISTS', 'DUPLICATE_OUTPUT', 'OUTPUT_CONFLICT', 'RENAME_COLLISION'].includes(error?.code)
              ? 'conflict'
              : 'failed';
            job[bucket] += 1;
            job.itemStatuses[key] = bucket;
            job.errors.push({ path: currentFile, code: error?.code || 'INTERNAL_ERROR', message: error?.message || 'Unexpected job error.' });
          }
        }
        job.processed += 1;
        this.emitUpdate(job);
      }
    };
    await Promise.all(Array.from({ length: Math.min(job.concurrency, Math.max(items.length, 1)) }, () => runNext()));
    if (job.cancelRequested) {
      for (const [key, status] of Object.entries(job.itemStatuses)) {
        if (status === 'pending') {
          job.itemStatuses[key] = 'cancelled';
          job.cancelled += 1;
        }
      }
    }
    job.currentFile = '';
    job.state = job.cancelRequested ? 'canceled' : 'completed';
    job.finishedAt = Date.now();
    this.emitUpdate(job);
    this.emit('complete', this.public(job));
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.state === 'queued' || job.state === 'running') {
      job.cancelRequested = true;
      job._controller.abort();
    }
    return true;
  }

  emitUpdate(job) { this.emit('progress', this.public(job)); }

  itemKey(item, index) { return String(item?.fileId || item?.id || index); }

  public(job) {
    const { _controller, ...safe } = job;
    return {
      ...safe,
      errors: job.errors.slice(-100),
      percent: job.total ? Math.round((job.processed / job.total) * 1000) / 10 : 0
    };
  }
}

module.exports = { JobManager };
