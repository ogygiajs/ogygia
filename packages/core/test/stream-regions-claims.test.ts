/**
 * What `server/stream-regions.ts` states, against the source: a `</TEMPLATE` in any case is framed;
 * each answer goes out the moment it settles, whatever the order of the calls; a call left out
 * (null, or a failed render) writes no parcel and the batch still ends.
 */
import { expect, it, vi } from 'vitest';
import { scope } from '@ogygia/machine';
import { batch_stream, build_parcel, done_parcel } from '../src/server/stream-regions.ts';

async function read(stream: ReadableStream<Uint8Array>): Promise<string> {
	let out = '';
	const decoder = new TextDecoder();
	for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>)
		out += decoder.decode(chunk, { stream: true });
	return out;
}

it('an answer carrying `</TEMPLATE` in any case is length-framed', () => {
	expect(build_parcel('A', '<x-a><TEMPLATE shadowrootmode="open"></TEMPLATE></x-a>')).toContain(
		'data-og-len='
	);
	expect(build_parcel('A', '<p></Template-ish></p>')).toContain('data-og-len=');
	expect(build_parcel('A', '<p>no box</p>')).not.toContain('data-og-len=');
});

it('each answer goes out the moment it settles, whatever the order of the calls', async () => {
	const delays: Record<string, number> = { slow: 40, fast: 0 };
	const out = await read(
		batch_stream(['slow', 'fast'], async (endpoint) => {
			await new Promise((r) => setTimeout(r, delays[endpoint]));
			return { slot: endpoint, html: `<p>${endpoint}</p>` };
		})
	);
	expect(out).toBe(
		build_parcel('fast', '<p>fast</p>') + build_parcel('slow', '<p>slow</p>') + done_parcel()
	);
});

it('a render that ignores the signal and lands after a cancel is dropped, never written', async () => {
	const enqueue = vi.spyOn(ReadableStreamDefaultController.prototype, 'enqueue');
	const stream = batch_stream(['late'], async () => {
		await new Promise((r) => setTimeout(r, 20));
		return { slot: 'late', html: '<p>late</p>' };
	});
	await new Promise((r) => setTimeout(r, 5));
	await stream.cancel();
	await new Promise((r) => setTimeout(r, 40));
	expect(enqueue.mock.calls).toEqual([]);
	enqueue.mockRestore();
});

it('the owner ending first aborts the renders and ends the batch with nothing written', async () => {
	const owner = scope();
	const aborted: string[] = [];
	const stream = batch_stream(
		['a'],
		(endpoint, signal) =>
			new Promise((resolve) => {
				signal.addEventListener('abort', () => {
					aborted.push(endpoint);
					resolve({ slot: endpoint, html: '<p>after</p>' });
				});
			}),
		owner
	);
	const reader = stream.getReader();
	await new Promise((r) => setTimeout(r, 5));
	owner.close();
	await new Promise((r) => setTimeout(r, 5));
	expect(aborted).toEqual(['a']);
	let written = '';
	const next = await Promise.race([
		reader.read(),
		new Promise<'open'>((r) => setTimeout(() => r('open'), 20))
	]);
	if (next !== 'open' && next.value) written = new TextDecoder().decode(next.value);
	expect(written).toBe('');
});

it('the owner ending after the batch ended is no failure: the batch is over, and stays so', async () => {
	const owner = scope();
	const out = await read(
		batch_stream(['ok'], async () => ({ slot: 'ok', html: '<p>ok</p>' }), owner)
	);
	expect(out).toBe(build_parcel('ok', '<p>ok</p>') + done_parcel());
	expect(() => owner.close()).not.toThrow();
});

it('a call left out or a failed render writes no parcel, and the batch still ends', async () => {
	const out = await read(
		batch_stream(['none', 'boom', 'ok'], async (endpoint) => {
			if (endpoint === 'none') return null;
			if (endpoint === 'boom') throw new Error('render failed');
			return { slot: 'ok', html: '<p>ok</p>' };
		})
	);
	expect(out).toBe(build_parcel('ok', '<p>ok</p>') + done_parcel());
});
