import { on } from 'svelte/events';

export interface RovingOptions {
	/** Which descendants are the roving items (e.g. `.og-nav-link`). */
	selector: string;
	/** Arrow axis. Nav rails are `'vertical'` (Up/Down); a tab bar is `'horizontal'` (Left/Right). */
	orientation?: 'vertical' | 'horizontal';
	/** Wrap past the ends (default `true`). */
	loop?: boolean;
}

function is_current(el: Element): boolean {
	const cur = el.getAttribute('aria-current');
	return (
		(cur != null && cur !== 'false') ||
		el.getAttribute('aria-selected') === 'true' ||
		el.classList.contains('og-active')
	);
}

/**
 * A roving tabindex, as a Svelte attachment (`{@attach roving({ selector })}`): the container's items
 * are ONE tab stop. It starts on the current item (`aria-current`, `aria-selected="true"` or
 * `.og-active`), else the first; arrows, Home and End move focus and carry the single `tabindex="0"`.
 * Focus only: Enter, Space and click stay native, so it fits links and manually activated tabs.
 */
export function roving(opts: RovingOptions) {
	const vertical = opts.orientation !== 'horizontal';
	const loop = opts.loop !== false;
	return (container: HTMLElement): (() => void) | undefined => {
		const items = () => [...container.querySelectorAll<HTMLElement>(opts.selector)];
		const seed = items();
		if (!seed.length) return;

		const set_stops = (active: number) => {
			const els = items();
			els.forEach((el, j) => (el.tabIndex = j === active ? 0 : -1));
		};
		const seeded = seed.findIndex(is_current);
		set_stops(seeded < 0 ? 0 : seeded);

		const next = vertical ? 'ArrowDown' : 'ArrowRight';
		const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
		const off = on(container, 'keydown', (e: KeyboardEvent) => {
			const els = items();
			const cur = els.indexOf(document.activeElement as HTMLElement);
			// @why a key pressed while focus is off the items is left alone (test: test/browser/roving.test.ts › a key pressed while focus is not on an item is left alone)
			if (cur < 0) return;
			let n = cur;
			if (e.key === next) n = cur + 1;
			else if (e.key === prev) n = cur - 1;
			else if (e.key === 'Home') n = 0;
			else if (e.key === 'End') n = els.length - 1;
			else return;
			n = loop ? (n + els.length) % els.length : Math.max(0, Math.min(els.length - 1, n));
			e.preventDefault();
			els.forEach((el, j) => (el.tabIndex = j === n ? 0 : -1));
			els[n].focus();
		});
		return () => off();
	};
}
