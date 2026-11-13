// The page beacon posts only to its own origin, and reads its target only from the head the
// server wrote (#753): a tag naming another origin, or one placed in the body, sends nothing.
import { afterEach, expect, test } from 'vitest';
import { mark } from '../../../devtools/src/profiler/client.ts';
import { _reset_beacon } from '../../../devtools/src/profiler/beacon.ts';
import { _restart_page_beacon } from '../../../devtools/src/profiler/beacon-standalone.ts';

let undo: (() => void)[] = [];
afterEach(() => {
	for (const u of undo) u();
	undo = [];
	(globalThis as unknown as Record<symbol, { stop(): void } | undefined>)[
		Symbol.for('ogygia.beacon')
	]?.stop();
});

/** a beacon tag with `content` in `where`, a fresh beacon, and every URL it sends to */
function beacon_with(content: string, where: HTMLElement): string[] {
	_reset_beacon();
	const meta = document.createElement('meta');
	meta.name = 'ogygia-profiler-beacon';
	meta.content = content;
	where.appendChild(meta);
	const urls: string[] = [];
	const orig_beacon = navigator.sendBeacon;
	const orig_fetch = globalThis.fetch;
	navigator.sendBeacon = ((url: string) => (
		urls.push(String(url)),
		true
	)) as typeof navigator.sendBeacon;
	globalThis.fetch = ((url: RequestInfo | URL) => (
		urls.push(String(url)),
		Promise.resolve(new Response(null, { status: 204 }))
	)) as typeof fetch;
	undo.push(() => {
		navigator.sendBeacon = orig_beacon;
		globalThis.fetch = orig_fetch;
		meta.remove();
	});
	_restart_page_beacon();
	mark('m', () => 1);
	dispatchEvent(new Event('pagehide'));
	return urls;
}

test('a beacon tag on the page own origin gets the posts', () => {
	const urls = beacon_with('/__profiler/beacon', document.head);
	expect(urls.length).toBeGreaterThan(0);
	expect(urls.every((u) => new URL(u, location.href).origin === location.origin)).toBe(true);
});

test('a beacon tag naming another origin gets no post', () => {
	expect(beacon_with('https://collector.example.com/beacon', document.head)).toEqual([]);
	expect(beacon_with('//collector.example.com/beacon', document.head)).toEqual([]);
});

test('a beacon tag outside the head gets no post', () => {
	expect(beacon_with('/__profiler/beacon', document.body)).toEqual([]);
});
