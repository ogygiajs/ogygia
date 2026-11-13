// A HOLE'S LIFE, AND ITS ISLAND'S WAKE, in a real browser: whatever brings a hole its answer (its own
// fetch, a twin's, a batch, a write at its address), a hydrating hole's island wakes once the answer
// is in; a kept fallback that later gets a real answer is no longer kept; a refetch that failed does
// not mark the next answer a refresh; every schedule a region arms is disarmed when it leaves; and a
// visitor's wake that failed is told so.
import { afterEach, beforeEach, expect, inject, test, vi } from 'vitest';
import { observe } from '@ogygia/machine';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset, stamp, write } from '../_frames.ts';
import { frameAddress } from '../../src/frame.ts';
import { KEEP_FALLBACK_HTML } from '../../src/keep-fallback-marker.ts';

const COUNTER = '/test/browser/fixtures/Counter.svelte';
const counter = () => decodeURIComponent(escape(atob(inject('counter_render_b64'))));
const ep = (id: string, props = 'W3t9XQ') =>
	`/__ogygia__?id=${id}&props=${props}&exp=9999999999&sig=stub`;

const real_fetch = window.fetch;
beforeEach(() => {
	document.body.innerHTML = '';
});
afterEach(() => {
	window.fetch = real_fetch;
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	_reset();
});

const html = (body: string) =>
	new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

/** A deferred client island: its answer swaps in, then its island wakes (`wake`). */
const interactive_hole = (endpoint: string, attrs = 'when="load" wake="load"') =>
	`<ogygia-region render="defer" ${attrs} entry="${COUNTER}" endpoint="${endpoint}"><p data-fallback>loading</p></ogygia-region>`;
const plain_hole = (endpoint: string) =>
	`<ogygia-region render="defer" when="load" endpoint="${endpoint}"><p data-fallback>loading</p></ogygia-region>`;

function insert(markup: string): HTMLElement[] {
	const box = document.createElement('div');
	box.innerHTML = markup;
	const regions = Array.from(box.querySelectorAll<HTMLElement>(':scope > ogygia-region'));
	document.body.append(...Array.from(box.childNodes));
	return regions;
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

test('a hole its twin answers while it waits to retry still wakes its island', async () => {
	const E = ep('life00000001');
	let calls = 0;
	window.fetch = async () => (++calls === 1 ? new Response('', { status: 500 }) : html(counter()));
	const [first] = insert(interactive_hole(E));
	bootDev();
	await expect.poll(() => calls, { timeout: 5_000 }).toBe(1);
	// its fetch failed and it waits to retry; the same call elsewhere on the page is answered
	insert(plain_hole(E));
	await expect.poll(() => first.querySelector('button') !== null, { timeout: 5_000 }).toBe(true);
	await expect
		.poll(() => first.hasAttribute('data-hydrated'), {
			timeout: 5_000,
			message: 'the island in the answer its twin brought woke'
		})
		.toBe(true);
});

test('a kept fallback that later gets a real answer is not kept any more, and its island wakes', async () => {
	const E = ep('life00000002');
	window.fetch = async () => new Response(null, { status: 204 });
	const [el] = insert(interactive_hole(E));
	bootDev();
	await expect.poll(() => el.hasAttribute('data-og-kept'), { timeout: 5_000 }).toBe(true);
	// a write at its address (a command that returned the region, a refresh) brings a real answer
	const a = frameAddress(E);
	write({ a, v: stamp(), html: counter() });
	await expect.poll(() => el.querySelector('button') !== null, { timeout: 5_000 }).toBe(true);
	expect(el.hasAttribute('data-og-kept'), 'no longer the kept fallback').toBe(false);
	expect(el.hasAttribute('data-revalidated'), 'its first answer, not a refresh').toBe(false);
	await expect
		.poll(() => el.hasAttribute('data-hydrated'), { timeout: 5_000, message: 'its island woke' })
		.toBe(true);
});

test('a hole answered, then told to keep its fallback twice, then answered again: each answer is a move of its own', async () => {
	const E = ep('life00000007');
	window.fetch = async () => html('<p data-answer>first</p>');
	const moves: string[] = [];
	const off = observe((name, from, to) => {
		if (name === 'hole-answer' && to) moves.push(`${from.kind} -> ${to.kind}`);
	});
	try {
		const [el] = insert(plain_hole(E));
		bootDev();
		await expect
			.poll(() => el.querySelector('[data-answer]') !== null, { timeout: 5_000 })
			.toBe(true);
		// (writes at its address: a command that returned the region, a refresh)
		const a = frameAddress(E);
		write({ a, v: stamp(), html: KEEP_FALLBACK_HTML });
		await expect.poll(() => el.hasAttribute('data-og-kept'), { timeout: 5_000 }).toBe(true);
		write({ a, v: stamp(), html: KEEP_FALLBACK_HTML });
		await expect.poll(() => moves.length, { timeout: 5_000 }).toBe(3);
		write({ a, v: stamp(), html: '<p data-answer>again</p>' });
		await expect.poll(() => el.textContent, { timeout: 5_000 }).toContain('again');
		expect(el.hasAttribute('data-og-kept'), 'no longer kept').toBe(false);
		expect(moves).toEqual([
			'none -> answered',
			'answered -> kept',
			'kept -> kept',
			'kept -> answered'
		]);
	} finally {
		off();
	}
});

test('a refetch that failed does not mark the hole’s first answer a refresh', async () => {
	// A static live region renders a hole; its next render re-mints the hole at a new address (new
	// props), and the hole refetches there. Both fetches are refused: the hole never had an answer.
	const E1 = ep('life00000003', 'cHJvcHMx');
	const E2 = ep('life00000003', 'cHJvcHMy');
	const calls: string[] = [];
	window.fetch = async (input) => {
		calls.push(String(input));
		return new Response('', { status: 403 });
	};
	const live = document.createElement('ogygia-region');
	live.setAttribute('live', '');
	document.body.append(live);
	bootDev();
	type Live = { applyLive(desc: Record<string, unknown>): Promise<void> };
	const tick_with = (endpoint: string) =>
		(live as unknown as Live).applyLive({
			id: 'life-live',
			module: '',
			props: {},
			html: plain_hole(endpoint),
			url: ep('life0000live')
		});
	await tick_with(E1);
	await expect.poll(() => calls.length, { timeout: 5_000 }).toBe(1);
	await tick_with(E2);
	await expect.poll(() => calls.length, { timeout: 5_000 }).toBe(2);
	expect(calls[1]).toContain('cHJvcHMy');
	await tick();
	const hole = live.querySelector('ogygia-region')!;
	// then its answer arrives at the new address: the hole's FIRST answer
	const a = frameAddress(E2);
	write({ a, v: stamp(), html: '<p data-testid="served">served</p>' });
	await expect
		.poll(() => hole.querySelector('[data-testid="served"]') !== null, { timeout: 5_000 })
		.toBe(true);
	expect(hole.hasAttribute('data-revalidated'), 'not a refresh: it had no answer before').toBe(
		false
	);
	expect(hole.hasAttribute('data-hydrated'), 'marked answered').toBe(true);
});

test('a refresh that re-mints a hole while its first fetch is out shows the new address’s answer, not the old one', async () => {
	// The live region's first render mints the hole at E1; its fetch is out when the next render
	// re-mints it at E2 (new props). The old answer lands last: the hole must end on E2's answer.
	const E1 = ep('life00000005', 'cHJvcHMx');
	const E2 = ep('life00000005', 'cHJvcHMy');
	const answers = new Map<string, (r: Response) => void>();
	window.fetch = (input) =>
		new Promise<Response>((resolve) =>
			answers.set(String(input).includes('cHJvcHMy') ? 'E2' : 'E1', resolve)
		);
	const live = document.createElement('ogygia-region');
	live.setAttribute('live', '');
	document.body.append(live);
	bootDev();
	type Live = { applyLive(desc: Record<string, unknown>): Promise<void> };
	const tick_with = (endpoint: string) =>
		(live as unknown as Live).applyLive({
			id: 'life-live',
			module: '',
			props: {},
			html: plain_hole(endpoint),
			url: ep('life0001live')
		});
	await tick_with(E1);
	await expect.poll(() => answers.has('E1'), { timeout: 5_000 }).toBe(true);
	await tick_with(E2);
	const hole = live.querySelector('ogygia-region')!;
	expect(hole.getAttribute('endpoint'), 'the refresh re-minted it').toBe(E2);
	await expect
		.poll(() => answers.has('E2'), { timeout: 5_000, message: 'the new address is asked for' })
		.toBe(true);
	answers.get('E2')!(html('<p data-testid="new">new props</p>'));
	await expect
		.poll(() => hole.querySelector('[data-testid="new"]') !== null, { timeout: 5_000 })
		.toBe(true);
	answers.get('E1')!(html('<p data-testid="old">old props</p>'));
	await tick(100);
	expect(hole.querySelector('[data-testid="old"]'), 'the old answer never paints').toBeNull();
	expect(hole.querySelector('[data-testid="new"]')).not.toBeNull();
});

test('a re-minted hole with no answer refetches after a refusal, after a server error, and after the network came back', async () => {
	// The first address is refused (`failed`); the refresh re-mints the hole and it refetches the new
	// one (`failed -> fetching`); a server error waits and refetches (`retrying -> fetching`); a
	// failure offline waits for the network and refetches (`offline -> fetching`).
	const E1 = ep('life00000008', 'cHJvcHMx');
	const E2 = ep('life00000008', 'cHJvcHMy');
	let online = true;
	Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
	let second = 0;
	window.fetch = async (input) => {
		if (!String(input).includes('cHJvcHMy')) return new Response('', { status: 403 });
		second++;
		if (second === 1) return new Response('', { status: 500 });
		if (second === 2) {
			online = false;
			throw new TypeError('Failed to fetch');
		}
		return html('<p data-testid="served">served</p>');
	};
	const moves: string[] = [];
	const stop = observe((name, from, to) => {
		if (name === 'hole' && to) moves.push(`${from.kind} -> ${to.kind}`);
	});
	try {
		const live = document.createElement('ogygia-region');
		live.setAttribute('live', '');
		document.body.append(live);
		bootDev();
		type Live = { applyLive(desc: Record<string, unknown>): Promise<void> };
		const tick_with = (endpoint: string) =>
			(live as unknown as Live).applyLive({
				id: 'life-live',
				module: '',
				props: {},
				html: plain_hole(endpoint),
				url: ep('life0002live')
			});
		await tick_with(E1);
		await expect.poll(() => moves.includes('fetching -> failed'), { timeout: 5_000 }).toBe(true);
		await tick_with(E2);
		await expect.poll(() => moves.includes('fetching -> offline'), { timeout: 5_000 }).toBe(true);
		online = true;
		window.dispatchEvent(new Event('online'));
		const hole = live.querySelector('ogygia-region')!;
		await expect
			.poll(() => hole.querySelector('[data-testid="served"]') !== null, { timeout: 5_000 })
			.toBe(true);
		expect(moves).toContain('failed -> fetching');
		expect(moves).toContain('retrying -> fetching');
		expect(moves).toContain('offline -> fetching');
	} finally {
		stop();
		delete (navigator as unknown as Record<string, unknown>).onLine;
	}
});

test('a hole answered twice moves once per answer, and the second answer is the one on screen', async () => {
	const E = ep('life00000006');
	window.fetch = async () => html('<p data-testid="first">first</p>');
	const moves: string[] = [];
	const stop = observe((name, from, to) => {
		if (name === 'hole-answer' && to) moves.push(`${from.kind} -> ${to.kind}`);
	});
	try {
		const [el] = insert(plain_hole(E));
		bootDev();
		await expect
			.poll(() => el.querySelector('[data-testid="first"]') !== null, { timeout: 5_000 })
			.toBe(true);
		// a refresh at its address (a write: a command that returned the region, a revalidate)
		const a = frameAddress(E);
		write({ a, v: stamp(), html: '<p data-testid="second">second</p>' });
		await expect
			.poll(() => el.querySelector('[data-testid="second"]') !== null, { timeout: 5_000 })
			.toBe(true);
		expect(moves, 'each answer on screen is a move of its own').toEqual([
			'none -> answered',
			'answered -> answered'
		]);
	} finally {
		stop();
	}
});

test('a hole that arms two media schedules disarms both when it leaves', async () => {
	const added = new Set<unknown>();
	const removed = new Set<unknown>();
	const add = MediaQueryList.prototype.addEventListener;
	const remove = MediaQueryList.prototype.removeEventListener;
	vi.spyOn(MediaQueryList.prototype, 'addEventListener').mockImplementation(function (
		this: MediaQueryList,
		...args: Parameters<MediaQueryList['addEventListener']>
	) {
		if (args[0] === 'change') added.add(args[1]);
		return add.apply(this, args);
	});
	vi.spyOn(MediaQueryList.prototype, 'removeEventListener').mockImplementation(function (
		this: MediaQueryList,
		...args: Parameters<MediaQueryList['removeEventListener']>
	) {
		if (args[0] === 'change') removed.add(args[1]);
		return remove.apply(this, args);
	});
	window.fetch = async () => html('<p>never</p>');
	// `when` and `prefetch` both media queries that do not match: both listen for a change
	const [el] = insert(
		`<ogygia-region render="defer" when="(min-width: 99999px)" prefetch="(min-height: 99999px)" endpoint="${ep('life00000004')}"><p>fallback</p></ogygia-region>`
	);
	bootDev();
	await tick();
	expect(added.size, 'both schedules listen').toBe(2);
	el.remove();
	await tick();
	expect(
		[...added].filter((on) => !removed.has(on)),
		'no listener left behind'
	).toHaveLength(0);
});

test('a hole whose prefetch and island both wait to be visible stops watching for both when it leaves', async () => {
	const unobserved: Element[] = [];
	const unobserve = IntersectionObserver.prototype.unobserve;
	vi.spyOn(IntersectionObserver.prototype, 'unobserve').mockImplementation(function (
		this: IntersectionObserver,
		target: Element
	) {
		unobserved.push(target);
		return unobserve.call(this, target);
	});
	window.fetch = async () => html(counter());
	// fetched at idle, warmed when visible, its island wakes when visible: far below the fold
	const [el] = insert(
		`<div style="height:5000px"></div>${interactive_hole(ep('life00000005'), 'when="idle" prefetch="visible" wake="visible"')}`
	);
	bootDev();
	await expect.poll(() => el.querySelector('button') !== null, { timeout: 5_000 }).toBe(true);
	await tick();
	el.remove();
	await tick();
	expect(unobserved, 'nothing watches the element after it left').toContain(el);
});

test('an interaction island that fails to wake says so, and its click is replayed on the server markup', async () => {
	const errors: unknown[][] = [];
	vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args));
	// its module loads, but it is no component: hydrating it throws
	document.body.innerHTML =
		'<ogygia-region wake="interaction" entry="/test/browser/fixtures/entry-current.ts"><button id="press">press</button></ogygia-region>';
	bootDev();
	document.getElementById('press')!.click();
	await expect
		.poll(
			() => errors.some((args) => (args[0] as { code?: string })?.code === 'island_hydrate_failed'),
			{ timeout: 5_000 }
		)
		.toBe(true);
	await expect
		.poll(
			() =>
				errors.some(
					(args) => (args[0] as { code?: string })?.code === 'interaction_hydrate_failed'
				),
			{ timeout: 5_000, message: 'the capture heard that the wake failed' }
		)
		.toBe(true);
});

test('a region taken out while its island loads and put back wakes once, and stops catching clicks once awake', async () => {
	const SLOW = '/test/browser/fixtures/slow-entry.ts';
	document.body.innerHTML = `<ogygia-region wake="load" entry="${SLOW}">${counter()}</ogygia-region>`;
	const el = document.querySelector<HTMLElement>('ogygia-region')!;
	bootDev();
	// its module is on its way (it takes 400 ms)
	await expect
		.poll(
			() => performance.getEntriesByType('resource').some((r) => r.name.includes('slow-entry')),
			{ timeout: 5_000 }
		)
		.toBe(true);
	el.remove();
	await tick(10); // out past its task: torn down
	document.body.append(el); // put back while the module still loads: it arms again
	await expect.poll(() => el.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	await tick();
	// awake: a click is the island's own, never caught and queued for a replay
	const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
	el.querySelector('button')!.dispatchEvent(click);
	expect(click.defaultPrevented, 'an awake island’s click is not held for a replay').toBe(false);
	expect(el.getAttribute('data-og-woke')).not.toBe('interaction');
});

test('a hole whose failed fetch lands as it leaves the page settles quietly, whatever the timing', async () => {
	const thrown: unknown[] = [];
	const on_rejection = (e: PromiseRejectionEvent) => {
		thrown.push(e.reason);
		e.preventDefault();
	};
	window.addEventListener('unhandledrejection', on_rejection);
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		// the failure, then the region's removal k microtasks later: one of them falls between the
		// fetch's task failing and the hole hearing of it
		for (let k = 0; k < 12; k++) {
			let answer!: (r: Response) => void;
			window.fetch = () => new Promise<Response>((r) => (answer = r));
			const [el] = insert(plain_hole(ep(`lifefail${String(k).padStart(4, '0')}`)));
			bootDev();
			await expect.poll(() => typeof answer, { timeout: 5_000 }).toBe('function');
			answer(new Response('', { status: 500 }));
			for (let i = 0; i < k; i++) await Promise.resolve();
			el.remove();
			await tick(20);
			_reset();
		}
	} finally {
		window.removeEventListener('unhandledrejection', on_rejection);
	}
	expect(thrown.map((e) => String((e as Error)?.message ?? e))).toEqual([]);
});
