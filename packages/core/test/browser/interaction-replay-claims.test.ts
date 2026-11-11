// What runtime/interaction-replay.ts states, against the source, in a real browser: once an island
// is live, what the visitor typed comes back at each field's address (tag-checked, skipped when
// hydration kept the node), focus comes back, and the queued clicks replay a frame later, in order,
// at their address, inside a web component's shadow tree when that is where they landed, and not at
// all when the region left first.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { scope } from '@ogygia/machine';
import {
	resolve_address,
	type FieldSnapshot,
	type QueuedClick
} from '../../src/runtime/interaction.ts';
import { slots } from '../../src/runtime/slots.ts';
import { after_wake, replay_clicks } from '../../src/runtime/interaction-replay.ts';

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

let region: HTMLElement;
beforeEach(() => {
	slots.interaction_link = { resolve_address };
	region = document.createElement('div');
	document.body.append(region);
});
afterEach(() => {
	document.body.innerHTML = '';
});

/** A field as it was before hydration replaced it: detached, holding what was typed. */
function old_field(html: string, value: string): HTMLInputElement {
	const box = document.createElement('div');
	box.innerHTML = html;
	const el = box.firstElementChild as HTMLInputElement;
	el.value = value;
	return el;
}

const events = (el: Element) => {
	const seen: string[] = [];
	for (const type of ['input', 'change']) el.addEventListener(type, () => seen.push(type));
	return seen;
};

test('typed values come back at the field’s address, with input and change, and the selection', () => {
	region.innerHTML = '<p></p><input type="text">';
	const now = region.children[1] as HTMLInputElement;
	const seen = events(now);
	const before = old_field('<input type="text">', 'hello');
	before.setSelectionRange(1, 3);
	const fields: FieldSnapshot[] = [{ el: before, addr: [1], tag: 'INPUT' }];
	after_wake(region, fields, null, [], scope());
	expect(now.value).toBe('hello');
	expect(seen).toEqual(['input', 'change']);
	expect([now.selectionStart, now.selectionEnd]).toEqual([1, 3]);
});

test('a checkbox’s checked state comes back', () => {
	region.innerHTML = '<input type="checkbox">';
	const now = region.children[0] as HTMLInputElement;
	const before = old_field('<input type="checkbox">', 'on');
	before.checked = true;
	after_wake(region, [{ el: before, addr: [0], tag: 'INPUT' }], null, [], scope());
	expect(now.checked).toBe(true);
});

test('a field whose node hydration kept, or whose address now holds another tag, is left alone', () => {
	region.innerHTML = '<input type="text"><textarea></textarea>';
	const kept = region.children[0] as HTMLInputElement;
	kept.value = 'kept';
	const kept_seen = events(kept);
	const other = region.children[1] as HTMLTextAreaElement;
	const fields: FieldSnapshot[] = [
		{ el: kept, addr: [0], tag: 'INPUT' },
		{ el: old_field('<input type="text">', 'lost'), addr: [1], tag: 'INPUT' }
	];
	after_wake(region, fields, null, [], scope());
	expect(kept_seen).toEqual([]);
	expect(other.value).toBe('');
});

test('focus comes back to the element at the focused address', () => {
	region.innerHTML = '<button>a</button><input type="text">';
	after_wake(region, [], [1], [], scope());
	expect(document.activeElement).toBe(region.children[1]);
});

test('clicks replay a frame later, in order, at their address, and only on a matching tag', async () => {
	region.innerHTML = '<button>a</button><button>b</button><span></span>';
	const order: string[] = [];
	for (const b of region.children) b.addEventListener('click', () => order.push(b.textContent!));
	const queued: QueuedClick[] = [
		{ addr: [1], deep: null, tag: 'BUTTON', init: { bubbles: true } },
		{ addr: [0], deep: null, tag: 'BUTTON', init: { bubbles: true } },
		{ addr: [2], deep: null, tag: 'BUTTON', init: { bubbles: true } }
	];
	replay_clicks(region, queued, scope());
	expect(order).toEqual([]);
	await frame();
	expect(order).toEqual(['b', 'a']);
	expect(queued).toEqual([]);
});

test('a click that landed inside a web component’s shadow tree replays there', async () => {
	region.innerHTML = '<x-replay-host></x-replay-host>';
	const host = region.children[0]!;
	const inner = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('button'));
	let inner_clicks = 0;
	let host_clicks = 0;
	inner.addEventListener('click', () => inner_clicks++);
	host.addEventListener('click', () => host_clicks++);
	replay_clicks(
		region,
		[{ addr: [0], deep: inner, tag: 'X-REPLAY-HOST', init: { bubbles: true, composed: true } }],
		scope()
	);
	await frame();
	expect(inner_clicks).toBe(1);
	expect(host_clicks).toBe(1);
});

test('a region gone before the frame replays nothing', async () => {
	region.innerHTML = '<button>a</button>';
	let clicks = 0;
	region.children[0]!.addEventListener('click', () => clicks++);
	const owner = scope();
	replay_clicks(region, [{ addr: [0], deep: null, tag: 'BUTTON', init: {} }], owner);
	owner.close();
	await frame();
	expect(clicks).toBe(0);
});
