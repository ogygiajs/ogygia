/**
 * The behaviors workers.md claims for the lab's `run: 'worker'` slice, checked on real threads:
 * `node build.ts && node dist/check.js` (LAB_THREADS and LAB_DEADLINE_MS are set below).
 */
import assert from 'node:assert/strict';
import { scope } from '@ogygia/machine';
import { spin, crash, fail } from './probe-jobs.ts' with { run: 'worker' };
import { owned, close_threads, pool_stats, warm_threads, STALE, ThreadError } from './thread.ts';

await warm_threads();
const results: string[] = [];
async function check(name: string, body: () => Promise<void>): Promise<void> {
	await body();
	results.push('ok   ' + name);
}

await check('calls run on worker threads, side by side', async () => {
	const started = performance.now();
	const ids = await Promise.all([spin(100), spin(100)]);
	const took = performance.now() - started;
	assert.ok(
		ids.every((id) => id > 0),
		'thread ids: ' + ids.join(',')
	);
	assert.notEqual(ids[0], ids[1]);
	assert.ok(took < 180, 'two 100 ms calls on 2 threads took ' + Math.round(took) + ' ms');
});

await check(
	'an owner that closes gets STALE at once, and its queued call never starts',
	async () => {
		const owner = scope();
		const call = owned(owner, spin);
		// two threads busy, so the third call queues
		const busy = [spin(150), spin(150)];
		const queued = call(10);
		const dropped_before = pool_stats.dropped;
		owner.close();
		assert.equal(await queued, STALE);
		await Promise.all(busy);
		await spin(1); // the pump has run past the dropped job
		assert.equal(pool_stats.dropped, dropped_before + 1);
	}
);

await check('an error crosses as a coded ThreadError with the worker stack', async () => {
	await assert.rejects(fail('bad input'), (e: unknown) => {
		assert.ok(e instanceof ThreadError);
		assert.equal(e.code, 'workers_call_failed');
		assert.match(e.message, /bad input/);
		assert.match(e.message, /ogygiajs\.dev\/e\/workers_call_failed/);
		return true;
	});
});

await check('a worker that dies fails its call, and the slot comes back', async () => {
	await assert.rejects(
		crash(),
		(e: unknown) => e instanceof ThreadError && e.code === 'workers_thread_crashed'
	);
	await warm_threads();
	assert.ok((await spin(1)) > 0);
});

await check(
	'a call past its deadline terminates its thread (a real cancel), and the slot comes back',
	async () => {
		const before = pool_stats.timeouts;
		await assert.rejects(
			spin(5_000),
			(e: unknown) => e instanceof ThreadError && e.code === 'workers_call_timeout'
		);
		assert.equal(pool_stats.timeouts, before + 1);
		await warm_threads();
		assert.ok((await spin(1)) > 0);
	}
);

close_threads();
console.log(results.join('\n'));
