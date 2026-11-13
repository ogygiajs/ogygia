// A batch of holes as the devtools see it: each batch numbered, each part it carried said once, and
// its end. (devtools on for this file: the gate is read off the global at first import)
import { afterEach, expect, test, vi } from 'vitest';

(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
const { streamFrames } = await import('../../src/runtime/frame-nav.ts');
const { _reset } = await import('../../src/runtime/frame-store.ts');
const { build_parcel } = await import('../../src/server/stream-regions.ts');
const { snapshot, clear, configure } = await import('../../src/events/bus.ts');

const ep = (sig: string) => `/__ogygia__?id=bbbbbbbbbbbb&props=${sig}&exp=9999999999&sig=${sig}`;

afterEach(() => {
	vi.restoreAllMocks();
	_reset();
});

test('two batches are numbered apart, and parts split over reads are each said once', async () => {
	configure({ active: true, cap: 4096 });
	clear();
	vi.spyOn(window, 'fetch').mockImplementation(async (_i, init) => {
		const [a, b] = JSON.parse(String(init?.body)) as string[];
		const sig = (e: string) => new URL(e, location.href).searchParams.get('sig')!;
		const chunks = [build_parcel(sig(a), '<p>a</p>'), build_parcel(sig(b), '<p>b</p>')];
		let i = 0;
		return new Response(
			new ReadableStream<Uint8Array>({
				pull(c) {
					if (i < chunks.length) c.enqueue(new TextEncoder().encode(chunks[i++]));
					else c.close();
				}
			}),
			{ status: 200 }
		);
	});
	await streamFrames([ep('x1'), ep('x2')], 'page');
	await streamFrames([ep('y1'), ep('y2')], 'page');
	const events = snapshot().filter((e) => e.name.startsWith('region.batch.'));
	const batch = (e: unknown) => (e as { batch: number }).batch;
	const sent = events.filter((e) => e.name === 'region.batch.sent').map(batch);
	expect(sent).toHaveLength(2);
	expect(sent[1]).toBe(sent[0] + 1);
	const parts = events
		.filter((e) => e.name === 'region.batch.part')
		.map((e) => (e as unknown as { endpoint: string }).endpoint);
	expect(parts).toEqual([ep('x1'), ep('x2'), ep('y1'), ep('y2')]);
});
