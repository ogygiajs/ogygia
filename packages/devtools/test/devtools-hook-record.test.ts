import { beforeEach, describe, expect, it, vi } from 'vitest';
import { record_hook } from '../src/devtools/hook-record.ts';
import { hook_entries, on_hook } from '../src/devtools/hook-entries.ts';

const RECORD = Symbol.for('ogygia.hook-record');
const region = (attrs: Record<string, string>, connected = true) =>
	({
		isConnected: connected,
		getAttribute: (k: string) => attrs[k] ?? null,
		hasAttribute: (k: string) => k in attrs
	}) as unknown as Element;

beforeEach(() => {
	delete (globalThis as Record<symbol, unknown>)[RECORD];
	vi.unstubAllGlobals();
});

describe('the hook record', () => {
	it('keeps each call with when it came and the region its element names', () => {
		const el = region({ 'data-og-fp': 'f1', entry: '/a.js' });
		record_hook('regionFailed', { el, message: 'boom', since: 1 });
		const [e] = hook_entries();
		expect(e).toMatchObject({ hook: 'regionFailed', fp: 'f1', entry: '/a.js', message: 'boom' });
		expect(typeof e.at).toBe('number');
	});

	it('holds a region only weakly and keeps no server markup, so a region the page left can go', () => {
		const el = region({ 'data-og-fp': 'f2' });
		record_hook('regionHydrated', { el, t0: 1, tLoaded: 2, tDone: 3, ssrHtml: '<p>big</p>' });
		const [e] = hook_entries();
		expect(e.el).toBeInstanceOf(WeakRef);
		expect(e.el?.deref()).toBe(el);
		expect('ssrHtml' in e).toBe(false);
	});

	it('the writer and the readers, in any copy, share one record, and a listener hears each call', async () => {
		const heard: string[] = [];
		const stop = on_hook((e) => heard.push(e.hook));
		vi.resetModules();
		const other = await import('../src/devtools/hook-record.ts');
		expect(other.record_hook).not.toBe(record_hook);
		other.record_hook('navStarted', { from: '/', to: '/b', type: 'link' });
		expect(hook_entries().map((e) => e.hook)).toEqual(['navStarted']);
		stop();
		record_hook('navStarted', { from: '/b', to: '/c', type: 'link' });
		expect(heard).toEqual(['navStarted']);
	});
});

describe('settled', () => {
	it('a live region that mounted (no regionHydrated after it) and one that left mid-wake are not in flight', async () => {
		vi.stubGlobal('document', { readyState: 'complete' });
		const { settled } = await import('../src/devtools/testing-engine.ts');
		const now = performance.now();
		vi.spyOn(performance, 'now')
			.mockReturnValueOnce(now - 1000)
			.mockReturnValueOnce(now - 1000);
		record_hook('regionMount', {
			el: region({ 'data-og-fp': 'live', 'data-hydrated': '' }),
			entry: '/live.js',
			urls: []
		});
		record_hook('regionMount', {
			el: region({ 'data-og-fp': 'gone' }, false),
			entry: '/gone.js',
			urls: []
		});
		vi.restoreAllMocks();
		expect(await settled(300, 2000)).toBe(true);
	});

	it('a region that mounted and is still waking holds it', async () => {
		vi.stubGlobal('document', { readyState: 'complete' });
		const { settled } = await import('../src/devtools/testing-engine.ts');
		record_hook('regionMount', {
			el: region({ 'data-og-fp': 'waking' }),
			entry: '/w.js',
			urls: []
		});
		expect(await settled(0, 200)).toBe(false);
	});

	it('a hole that woke and then failed for good, or was answered, is not in flight', async () => {
		vi.stubGlobal('document', { readyState: 'complete' });
		const { settled } = await import('../src/devtools/testing-engine.ts');
		const failed = region({ 'data-og-hole': 'f' });
		const answered = region({ 'data-og-hole': 'a' });
		record_hook('regionWoke', { el: failed, when: 'load' });
		record_hook('regionWoke', { el: answered, when: 'load' });
		record_hook('holeFailed', { el: failed, id: 'f', reason: 'error', attempts: 3, t: 1 });
		record_hook('holeAnswered', { el: answered, start: 1 });
		const t0 = performance.now();
		expect(await settled(0, 2000)).toBe(true);
		expect(performance.now() - t0).toBeLessThan(1000);
	});

	it('a region that woke and is still downloading (no regionMount yet) holds it past the quiet time', async () => {
		vi.stubGlobal('document', { readyState: 'complete' });
		const { settled } = await import('../src/devtools/testing-engine.ts');
		const now = performance.now();
		vi.spyOn(performance, 'now').mockReturnValueOnce(now - 1000);
		record_hook('regionWoke', { el: region({ 'data-og-fp': 'downloading' }), when: 'load' });
		vi.restoreAllMocks();
		expect(await settled(300, 200)).toBe(false);
	});
});
