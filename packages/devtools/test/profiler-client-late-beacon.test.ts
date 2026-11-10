/**
 * `mark` hands its marks to the page's beacon, which devtools' client boot puts on the page. A
 * mark made before the beacon is there waits for it, however late it comes (a slow runtime chunk on
 * a slow phone): it is never dropped after a few seconds. The page here is a stand-in document with
 * the profiler's beacon tag; the beacon boots 11 s after the mark.
 */
import { afterAll, expect, it, vi } from 'vitest';

const g = globalThis as Record<string, unknown>;
const had_document = 'document' in g;
afterAll(() => {
	if (!had_document) delete g.document;
});

it('a mark made 11 s before the beacon loads reaches it', async () => {
	vi.stubGlobal('document', {
		readyState: 'complete',
		visibilityState: 'visible',
		querySelector: (sel: string) =>
			sel.includes('ogygia-profiler-beacon') ? { getAttribute: () => '/__profiler/beacon' } : null,
		querySelectorAll: () => [],
		addEventListener: () => {},
		removeEventListener: () => {}
	});
	// (the window's own listeners: the beacon listens for the page hiding)
	vi.stubGlobal('addEventListener', () => {});
	vi.stubGlobal('removeEventListener', () => {});
	vi.stubGlobal('location', new URL('http://localhost/'));
	const { mark } = await import('../src/profiler/client.ts');
	mark.start('early.boot').end();
	await new Promise((r) => setTimeout(r, 11_000));
	const { beacon_page, install_beacon } = await import('../src/profiler/beacon.ts');
	install_beacon();
	const page = beacon_page();
	expect(page?.marks.map((m) => m.name)).toContain('early.boot');
}, 20_000);
