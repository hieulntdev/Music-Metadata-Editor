'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { JobManager } = require('../../src/main/jobs/job-manager');

test('serialized job reports 500 independent successes', async () => {
  const manager = new JobManager();
  const items = Array.from({ length: 500 }, (_, index) => ({ fileId: String(index) }));
  manager.create('fixture-batch', items, async () => ({ status: 'saved' }));
  const [result] = await once(manager, 'complete');
  assert.equal(result.state, 'completed');
  assert.equal(result.processed, 500);
  assert.equal(result.saved, 500);
  assert.equal(result.failed, 0);
  assert.equal(result.conflict, 0);
});

test('cancel pending stops before starting another item', async () => {
  const manager = new JobManager();
  const started = [];
  const initial = manager.create('cancel-test', [1, 2, 3], async (item, job) => {
    started.push(item);
    if (item === 1) manager.cancel(job.id);
    return { status: 'saved' };
  });
  const [result] = await once(manager, 'complete');
  assert.equal(initial.total, 3);
  assert.deepEqual(started, [1]);
  assert.equal(result.state, 'canceled');
  assert.equal(result.saved, 1);
  assert.equal(result.cancelled, 2);
  assert.deepEqual(Object.values(result.itemStatuses), ['saved', 'cancelled', 'cancelled']);
});

test('concurrent matching processes exactly 50 tracks, records results, and respects its limit', async () => {
  const manager = new JobManager();
  let active = 0; let maximum = 0;
  const items = Array.from({ length: 50 }, (_, index) => ({ fileId: `track-${index}` }));
  manager.create('metadata-match', items, async (item) => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { status: 'matched', result: { fileId: item.fileId, candidates: [] } };
  }, { concurrency: 3 });
  const [result] = await once(manager, 'complete');
  assert.equal(maximum, 3);
  assert.equal(result.matched, 50);
  assert.equal(Object.keys(result.results).length, 50);
  assert.ok(Object.values(result.itemStatuses).every((status) => status === 'matched'));
});

test('cancelling concurrent matching aborts active work and marks queued items cancelled', async () => {
  const manager = new JobManager();
  const items = Array.from({ length: 6 }, (_, index) => ({ fileId: `track-${index}` }));
  const initial = manager.create('metadata-match', items, async (_item, _job, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
  }), { concurrency: 2 });
  await new Promise((resolve) => setImmediate(resolve));
  manager.cancel(initial.id);
  const [result] = await once(manager, 'complete');
  assert.equal(result.state, 'canceled');
  assert.equal(result.failed, 0);
  assert.equal(result.cancelled, 6);
  assert.ok(Object.values(result.itemStatuses).every((status) => status === 'cancelled'));
});
