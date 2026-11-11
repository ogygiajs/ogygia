/** Jobs for check.ts: work of a known length, and a worker that dies. */
import { threadId } from 'node:worker_threads';

/** Busy for `ms` (synchronous: nothing can interrupt it but the thread ending). */
export async function spin(ms: number): Promise<number> {
	const end = performance.now() + ms;
	while (performance.now() < end);
	return threadId;
}

export async function crash(): Promise<never> {
	process.exit(3);
}

export async function fail(message: string): Promise<never> {
	throw new TypeError(message);
}

export async function bytes(view: Uint8Array): Promise<number> {
	return view.byteLength;
}
