import type { Scope } from '@ogygia/machine';
import type { FieldSnapshot, QueuedClick } from './interaction.ts';
import { interaction_link } from './slots.ts';
import { emit as dt_emit } from '../events/bus.ts';
import { OG_FP } from '../wire-markup.ts';

const resolve_address = (region: Element, addr: number[]) =>
	interaction_link().resolve_address(region, addr);

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;

function restore_fields(region: Element, fields: FieldSnapshot[]) {
	for (const s of fields) {
		const el = resolve_address(region, s.addr);
		if (!el || el.tagName !== s.tag) continue;
		const f = el as HTMLInputElement;
		if (f === s.el) continue;
		let changed = false;
		if (f.value !== s.el.value) {
			f.value = s.el.value;
			changed = true;
		}
		if (s.el instanceof HTMLInputElement && f.checked !== s.el.checked) {
			f.checked = s.el.checked;
			changed = true;
		}
		if (changed) {
			try {
				const { selectionStart, selectionEnd } = s.el;
				if (selectionStart != null && selectionEnd != null) {
					f.setSelectionRange(selectionStart, selectionEnd);
				}
			} catch {
				// ok: non-text input types reject selection access; there is no selection to carry
			}
			f.dispatchEvent(new Event('input', { bubbles: true }));
			f.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}
}

/**
 * Replay the queued clicks in arrival order at each click's address (tag-checked against drift).
 * One frame later: hydration just (re)bound the island's web-component wiring (a dropdown web
 * component's `target` element, set by a reactive statement) and many components apply such
 * changes in their own render tick. A synchronous replay lands before that tick and toggles
 * nothing; after a frame the component is settled. The frame is `owner`'s (the region's lifetime in
 * the page): a region gone by then replays nothing.
 *
 * A click that landed inside a web component's shadow tree replays on that inner node (composed,
 * so the host hears it too): a click on the host never reaches a shadow-internal handler, and
 * hydration claims the host but leaves its shadow tree, so the inner node is still live.
 */
export function replay_clicks(region: Element, queued: QueuedClick[], owner: Scope): void {
	const replay = () => {
		for (const q of queued) {
			const t = resolve_address(region, q.addr);
			if (!t || t.tagName !== q.tag) continue;
			const deep = q.deep as Node | null;
			const target = deep && deep.isConnected && t.shadowRoot?.contains(deep) ? deep : t;
			target.dispatchEvent(new MouseEvent('click', q.init));
		}
		queued.length = 0;
	};
	owner.timeout(replay, 'frame');
}

/** The island is live: put back what the visitor did while it was waking, at each element's
 *  address (hydration may have replaced the nodes). Typed values and checked states come back
 *  (with their selection, and `input` and `change` so `bind:` syncs) where the address still holds
 *  the same tag; focus comes back; the queued clicks replay ({@link replay_clicks}). */
export function after_wake(
	region: Element,
	fields: FieldSnapshot[],
	active_addr: number[] | null,
	queued: QueuedClick[],
	owner: Scope
): void {
	restore_fields(region, fields);
	if (active_addr) {
		const el = resolve_address(region, active_addr);
		if (el instanceof HTMLElement && document.activeElement !== el) el.focus();
	}
	const replayed = queued.length;
	replay_clicks(region, queued, owner);
	if (DEVTOOLS)
		dt_emit({
			domain: 'runtime',
			name: 'interaction.replay',
			entry: region.getAttribute('entry') || undefined,
			fp: region.getAttribute(OG_FP) || undefined,
			clicks: replayed,
			fields: fields.length
		});
}
