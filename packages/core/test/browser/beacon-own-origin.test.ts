// The page beacon posts only to its own origin, and reads its target only from the head the
// server wrote (#753): a tag naming another origin, or one placed in the body, sends nothing.
import { afterEach, expect, test } from 'vitest';
import { mark } from '../../../devtools/src/profiler/client.ts';
import { _reset_beacon } from '../../../devtools/src/profiler/beacon.ts';
import { _restart_page_beacon } from '../../../devtools/src/profiler/beacon-standalone.ts';
import { scope } from '@ogygia/machine';
import { patch } from '../_patch.ts';

let owner = scope();
afterEach(() => {
	owner.close();
	owner = scope();
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
	patch(
		owner,
		navigator,
		'sendBeacon',
		() => (url: string | URL) => (urls.push(String(url)), true)
	);
	patch(
		owner,
		globalThis,
		'fetch',
		() => (url: RequestInfo | URL) => (
			urls.push(String(url)),
			Promise.resolve(new Response(null, { status: 204 }))
		)
	);
	owner.defer(() => meta.remove());
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
