/**
 * The worker half of `with { run: 'worker' }`: the compiler's worker chunk is
 *
 *   import * as m from './jobs.ts';
 *   import { serve } from './thread-worker.ts';
 *   serve(m);
 *
 * One call at a time (the pool never sends a second before the first answers). Errors cross as
 * plain data: name, message, stack.
 */
import { parentPort } from 'node:worker_threads';
import type { Reply } from './thread.ts';

export function serve(mod: Record<string, unknown>): void {
	const port = parentPort;
	if (port === null) throw new Error('thread-worker: not in a worker thread');
	// lives as long as the worker: the pool terminates it
	port.on('message', async (msg: { id: number; fn: string; args: unknown[] }) => {
		let reply: Reply;
		try {
			const fn = mod[msg.fn];
			if (typeof fn !== 'function') throw new Error('no export named ' + msg.fn);
			reply = { id: msg.id, ok: true, value: await fn(...msg.args) };
		} catch (e) {
			const error = e instanceof Error ? e : new Error(String(e));
			reply = {
				id: msg.id,
				ok: false,
				error: { name: error.name, message: error.message, stack: error.stack }
			};
		}
		port.postMessage(reply);
	});
	port.postMessage({ ready: true });
}
