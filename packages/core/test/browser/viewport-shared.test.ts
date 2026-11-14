// THE ONE VIEWPORT TRACKER (runtime/viewport.ts), in a real browser. The hydration
// scheduler's viewport snapshot and a `wake:'visible'` island both watch the island at the default
// margin; with one callback per element the wake replaced the snapshot, and every visible island
// then sat out the scheduler's whole 48 ms snapshot wait (62–84 ms late on a scroll, with nothing
// ahead of it). Both must hear every change, and one leaving must not silence the other.
import { expect, test } from 'vitest';
import { on_screen, once_on_screen, watch_viewport } from '../../src/runtime/viewport.ts';
import { hydrate_turn, register_region, unregister_region } from '../../src/runtime/schedule.ts';
import { scope, type Scope } from '@ogygia/machine';
import { patch } from '../_patch.ts';

const box = () => {
	const el = document.createElement('div');
	el.style.cssText = 'width:10px;height:10px';
	document.body.append(el);
	return el;
};
const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)));

test('an empty region at the fold, a line with no height, still counts as on screen', () => {
	const line = document.createElement('div');
	line.style.cssText = 'position:absolute;left:0;top:10px;width:100px;height:0';
	document.body.append(line);
	try {
		expect(on_screen(line)).toBe(true);
	} finally {
		line.remove();
	}
});

test('two watchers of one element at one margin both hear it; one stopping leaves the other', async () => {
	const el = box();
	const a: boolean[] = [];
	const b: boolean[] = [];
	const stop_a = watch_viewport(el, '0px', (v) => a.push(v));
	const stop_b = watch_viewport(el, '0px', (v) => b.push(v));
	await settle();
	expect(a).toEqual([true]);
	expect(b).toEqual([true]);
	stop_a();
	el.style.marginTop = '5000px'; // off screen
	await settle();
	expect(a).toEqual([true]);
	expect(b).toEqual([true, false]);
	stop_b();
	el.remove();
});

test('one function watching one element twice is two watches: stopping one leaves the other', async () => {
	const el = box();
	const heard: boolean[] = [];
	const same = (v: boolean) => heard.push(v);
	const stop_first = watch_viewport(el, '0px', same);
	const stop_second = watch_viewport(el, '0px', same);
	await settle();
	heard.length = 0;
	stop_first();
	el.style.marginTop = '5000px'; // off screen
	await settle();
	expect(heard).toEqual([false]);
	stop_second();
	el.remove();
});

test('a watcher that joins late gets the last known state (the browser will not report it again)', async () => {
	const el = box();
	const first: boolean[] = [];
	const stop = watch_viewport(el, '0px', (v) => first.push(v));
	await settle();
	expect(first).toEqual([true]);
	let fired = false;
	const stop_visible = once_on_screen(el, '0px', () => (fired = true));
	await settle();
	expect(fired).toBe(true); // already on screen: it wakes, and does not wait for a change
	stop();
	stop_visible();
	el.remove();
});

test('a visible island woken on screen gets its turn without the 48 ms snapshot wait', async () => {
	const el = box();
	register_region(el, scope()); // the scheduler's snapshot (at connect)
	let woke_at = 0;
	once_on_screen(el, '0px', () => (woke_at = performance.now())); // the island's wake, same margin
	await expect.poll(() => woke_at > 0).toBe(true);
	// the turn itself (the poll above checks every 50 ms: time from the ask, not the wake)
	const asked = performance.now();
	await hydrate_turn(el);
	const waited = performance.now() - asked;
	expect(waited, `turn came ${Math.round(waited)} ms after the ask`).toBeLessThan(30);
	unregister_region(el);
	el.remove();
});

test('a region with no box of its own follows what it renders, through a swap of its content', async () => {
	const region = document.createElement('div');
	region.style.display = 'contents';
	region.innerHTML = `<p style="position:absolute;top:${innerHeight + 500}px;margin:0">far</p>`;
	document.body.append(region);
	const heard: boolean[] = [];
	const stop = watch_viewport(region, '0px', (on) => heard.push(on));
	await settle();
	expect(heard).toEqual([false]);
	// its answer swaps in: what it renders now is on screen
	region.innerHTML = '<p style="margin:0">near</p>';
	await expect.poll(() => heard.at(-1), { timeout: 2_000 }).toBe(true);
	// a later watcher of a child it renders hears that child's own state at once
	const child: boolean[] = [];
	const stop_child = watch_viewport(region.firstElementChild!, '0px', (on) => child.push(on));
	await settle();
	expect(child).toEqual([true]);
	stop_child();
	stop();
	region.remove();
});

test('a child pushed out of the ones that stand for a box-less region is let go, and none is held after the watch', async () => {
	const region = document.createElement('div');
	region.style.display = 'contents';
	for (let i = 0; i < 20; i++) {
		const p = document.createElement('p');
		p.textContent = `row ${i}`;
		p.style.margin = '0';
		region.append(p);
	}
	document.body.append(region);
	const observed = new Set<Element>();
	const spies = scope();
	patch(
		spies,
		IntersectionObserver.prototype,
		'observe',
		(observe) =>
			function (this: IntersectionObserver, t: Element) {
				observed.add(t);
				return observe.call(this, t);
			}
	);
	patch(
		spies,
		IntersectionObserver.prototype,
		'unobserve',
		(unobserve) =>
			function (this: IntersectionObserver, t: Element) {
				observed.delete(t);
				return unobserve.call(this, t);
			}
	);
	try {
		const stop = watch_viewport(region, '0px', () => {});
		await settle();
		const sixteenth = region.children[15];
		expect(observed.has(sixteenth), 'the 16th child stands for the region').toBe(true);
		// a child goes in at the top: the 16th is now the 17th, past the ones that stand for it
		const top = document.createElement('p');
		top.style.margin = '0';
		top.textContent = 'new top row';
		region.prepend(top);
		await settle();
		expect(observed.has(sixteenth), 'pushed out of the first 16: no longer watched').toBe(false);
		stop();
		expect([...observed], 'nothing is held after the last watcher stops').toEqual([]);
	} finally {
		spies.close();
		region.remove();
	}
});

/** What each swap observer (a `MutationObserver`) observes now, kept until `owner` closes: its
 *  targets since its last `disconnect()`. */
function spy_mutation_targets(owner: Scope): Map<MutationObserver, Set<Element>> {
	const by = new Map<MutationObserver, Set<Element>>();
	patch(
		owner,
		MutationObserver.prototype,
		'observe',
		(observe) =>
			function (this: MutationObserver, t: Node, o?: MutationObserverInit) {
				let set = by.get(this);
				if (!set) by.set(this, (set = new Set()));
				set.add(t as Element);
				return observe.call(this, t, o);
			}
	);
	patch(
		owner,
		MutationObserver.prototype,
		'disconnect',
		(disconnect) =>
			function (this: MutationObserver) {
				by.delete(this);
				return disconnect.call(this);
			}
	);
	return by;
}

const targets = (by: Map<MutationObserver, Set<Element>>): Element[] =>
	[...by.values()].flatMap((set) => [...set]);

test('a box-less region the tracker lets go is no longer observed for swaps (#1255)', async () => {
	const spies = scope();
	const by = spy_mutation_targets(spies);
	const region = document.createElement('div');
	region.style.display = 'contents';
	region.innerHTML = '<p style="margin:0">rendered</p>';
	document.body.append(region);
	try {
		const stop = watch_viewport(region, '7px', () => {});
		await settle();
		expect(targets(by), 'its content swaps are heard while it is watched').toContain(region);
		// the region leaves the page and its watch stops (a router navigation took it off)
		region.remove();
		stop();
		await settle();
		expect(targets(by), 'let go: the swap observer holds it no more').not.toContain(region);
	} finally {
		spies.close();
	}
});

test('a box-less child swapped out of a box-less region is no longer observed for swaps (#1255)', async () => {
	const spies = scope();
	const by = spy_mutation_targets(spies);
	const region = document.createElement('div');
	region.style.display = 'contents';
	region.innerHTML = '<div style="display:contents"><p style="margin:0">inner</p></div>';
	document.body.append(region);
	const inner = region.firstElementChild!;
	try {
		const stop = watch_viewport(region, '9px', () => {});
		await settle();
		expect(targets(by), 'the box-less child it renders is followed too').toContain(inner);
		// its answer swaps in: the box-less child is gone, a plain one stands for it now
		region.innerHTML = '<p style="margin:0">swapped</p>';
		await settle();
		expect(targets(by), 'still watched: the region itself').toContain(region);
		expect(targets(by), 'the child that left is held no more').not.toContain(inner);
		stop();
		await settle();
		expect(targets(by), 'nothing is held after the last watcher stops').toEqual([]);
	} finally {
		spies.close();
		region.remove();
	}
});
