import { afterEach, expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';

const LABEL = '/test/browser/fixtures/Label.svelte';
const SNIPPET_BOOTS = Symbol.for('ogygia.snippet-boots');
type Host = Element & { [SNIPPET_BOOTS]?: Promise<unknown>[] };

const island = (): Host => {
	const body = from_b64(inject('label_render_b64'));
	const wrap = document.createElement('div');
	wrap.innerHTML = `<ogygia-region wake="load" entry="${LABEL}">${body}</ogygia-region>`;
	return wrap.firstElementChild as Host;
};
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

afterEach(() => {
	document.body.innerHTML = '';
});

test('a region is hydrated only once the snippets its own snippets render have booted too', async () => {
	const host = island();
	let inner_booted = false;
	const inner = later(300).then(() => void (inner_booted = true));
	// the outer snippet boots once the region waits on it, and its own snippet registers then
	const taken = new Promise<void>((r) => {
		const check = () => (host[SNIPPET_BOOTS]?.length === 0 ? r() : setTimeout(check, 10));
		check();
	});
	host[SNIPPET_BOOTS] = [taken.then(() => void host[SNIPPET_BOOTS]!.push(inner))];
	document.body.append(host);
	bootDev();
	await expect.poll(() => host.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	expect(inner_booted).toBe(true);
});

test(
	'a snippet that never boots holds its region’s hydrated signal 10 s at most',
	{ timeout: 20_000 },
	async () => {
		const host = island();
		host[SNIPPET_BOOTS] = [new Promise(() => {})];
		document.body.append(host);
		const t0 = performance.now();
		bootDev();
		await expect
			.poll(() => host.hasAttribute('data-hydrated'), { timeout: 15_000, interval: 200 })
			.toBe(true);
		expect(performance.now() - t0).toBeGreaterThanOrEqual(9_900);
	}
);
