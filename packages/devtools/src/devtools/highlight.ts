/**
 * Light up MANY elements on the page at once — the profile's "these 290 shadow roots", "every
 * element Icon.svelte rendered", "the largest paint". Boxes live in the dock's own shadow root (a
 * fixed, click-through layer), follow scroll and resize while shown, and cap at a few hundred so a
 * huge match stays cheap. No Svelte: plain DOM, one layer, replaced on each call.
 */
import { scope, type Scope } from '@ogygia/machine';
import { OG_HIGHLIGHT } from '@ogygia/core/internal/instruments';

const MAX_BOXES = 400;

/** The layer while it is shown: the elements it boxes and their caption, its scroll and resize
 *  watch and its queued frame (its scope's). Hiding it closes the scope and lets the elements go. */
interface Shown {
	layer: HTMLDivElement;
	scope: Scope;
	els: Element[];
	label: string;
	queued: boolean;
}

/** The boxes over page elements, in the dock's shadow root. */
export class Highlighter {
	#root: ShadowRoot | null = null;
	#shown: Shown | null = null;
	readonly #schedule = (): void => {
		const shown = this.#shown;
		if (!shown || shown.queued) return;
		shown.queued = true;
		shown.scope.timeout(() => this.#draw(), 'frame');
	};

	/** The dock's shadow root (ui-app.ts sets it at mount). */
	set_root(r: ShadowRoot): void {
		this.#root = r;
	}

	/** Show boxes over `els` (with a caption); `scroll` brings the first into view. */
	show(els: Element[], caption = '', scroll = false): void {
		const root = this.#root;
		if (!root) return;
		if (!this.#shown) {
			const layer = document.createElement('div');
			layer.setAttribute(OG_HIGHLIGHT, '');
			layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483600';
			root.prepend(layer);
			const watch = scope();
			watch.on(globalThis, 'scroll', this.#schedule, { passive: true, capture: true });
			watch.on(globalThis, 'resize', this.#schedule, { passive: true });
			watch.defer(() => layer.remove());
			this.#shown = { layer, scope: watch, els, label: caption, queued: false };
		} else {
			this.#shown.els = els;
			this.#shown.label = caption;
		}
		if (scroll && els[0]) {
			try {
				els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
			} catch {
				// ok: a detached element cannot scroll into view
			}
		}
		this.#schedule();
	}

	clear(): void {
		this.#shown?.scope.close();
		this.#shown = null;
	}

	/** How many boxes are shown now (tests). */
	count(): number {
		return this.#shown?.els.length ?? 0;
	}

	#draw(): void {
		const shown = this.#shown;
		if (!shown) return;
		shown.queued = false;
		const { layer, els, label } = shown;
		layer.textContent = '';
		const vw = innerWidth;
		const vh = innerHeight;
		let n = 0;
		for (const el of els) {
			if (n >= MAX_BOXES) break;
			const r = el.getBoundingClientRect();
			if (!r.width && !r.height) continue;
			if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
			const b = document.createElement('div');
			b.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:1.5px solid #f472b6;background:rgba(244,114,182,.12);border-radius:3px;box-sizing:border-box`;
			layer.appendChild(b);
			n++;
		}
		if (label) {
			const tag = document.createElement('div');
			tag.textContent = label;
			tag.style.cssText =
				'position:fixed;left:12px;top:12px;padding:4px 9px;border-radius:7px;background:#831843;color:#fce7f3;font:600 11px/1.4 ui-monospace,monospace;box-shadow:0 4px 12px rgba(0,0,0,.35)';
			layer.appendChild(tag);
		}
	}
}

/** The page's one highlighter: the dock is one per document. */
export const highlighter: Highlighter = new Highlighter();
