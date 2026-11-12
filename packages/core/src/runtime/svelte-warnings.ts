/**
 * SVELTE'S HYDRATION WARNINGS, KEPT — in dev, Svelte says in the console when the server and the
 * browser disagreed while an island hydrated (`hydration_html_changed`, `hydration_attribute_changed`,
 * `hydration_mismatch`…). Svelte keeps the server's value, so nothing on screen shows it: the console
 * line is the only trace. This keeps each one (with the island hydrating at the time) for the devtools
 * and the profiler's browser half. Dev only (production Svelte has no such warnings); the console line
 * itself goes out unchanged. No regex: warnings are rare, read by string search.
 */
import { clock, type Scope } from '@ogygia/machine';
import { OG_FP } from '../wire-markup.ts';

export interface SvelteWarning {
	code: string;
	message: string;
	file?: string;
	fp?: string;
	t: number;
}

let tapped = false;
let hydrating: Element | null = null;
/** The page's Svelte hydration warnings, as the console tap heard them: the first
 *  {@link WarningLog.MAX}, and who hears each as it comes. */
class WarningLog {
	static readonly MAX = 100;
	readonly kept: SvelteWarning[] = [];
	readonly listeners: ((w: SvelteWarning) => void)[] = [];
	/** Keeps `w` and tells the listeners (`false`: the log is full, nothing kept or told). */
	add(w: SvelteWarning): boolean {
		if (this.kept.length >= WarningLog.MAX) return false;
		this.kept.push(w);
		for (const cb of this.listeners) cb(w);
		return true;
	}
}
const log = new WarningLog();

/** core.ts marks the island whose hydrate step is running. Svelte raises some warnings as the
 *  step's effects flush (a microtask after it returns): the mark holds until the task ends, and
 *  islands hydrate one per task, so the next one never inherits it. The task's end is `owner`'s to
 *  wait for (the island's lifetime in the page): an island gone first takes its mark with it. */
export function set_hydrating(el: Element, owner: Scope): void {
	hydrating = el;
	const clear = () => {
		if (hydrating === el) hydrating = null;
	};
	owner.timeout(clear, 0);
	owner.defer(clear);
}

export function svelte_warnings(): SvelteWarning[] {
	return log.kept.slice();
}

export function on_svelte_warning(cb: (w: SvelteWarning) => void): void {
	log.listeners.push(cb);
}

/** `%c[svelte] code\n%cmessage …` → the parts (null: not a Svelte hydration warning). */
export function parse_svelte_warning(
	text: string
): { code: string; message: string; file?: string } | null {
	const at = text.indexOf('[svelte] ');
	if (at === -1) return null;
	let rest = text.slice(at + 9);
	let end = 0;
	while (end < rest.length && rest.charCodeAt(end) > 32) end++;
	const code = rest.slice(0, end);
	if (!code.startsWith('hydration')) return null;
	rest = rest.slice(end).trim();
	if (rest.startsWith('%c')) rest = rest.slice(2);
	const line_end = rest.indexOf('\nhttps://');
	const message = (line_end === -1 ? rest : rest.slice(0, line_end)).trim().slice(0, 400);
	// the component file it names (an absolute path or URL ending in .svelte)
	let file: string | undefined;
	const dot = message.indexOf('.svelte');
	if (dot !== -1) {
		let start = dot;
		while (start > 0 && message.charCodeAt(start - 1) > 32 && message[start - 1] !== '`') start--;
		// (Svelte breaks its paths with zero-width spaces so the console can wrap them)
		file = message
			.slice(start, dot + 7)
			.split('​')
			.join('');
	}
	return { code, message, ...(file ? { file } : {}) };
}

export function tap_svelte_warnings(): void {
	if (tapped || typeof console === 'undefined') return;
	tapped = true;
	const warn = console.warn;
	console.warn = function (...args: unknown[]) {
		try {
			const first = args[0];
			if (typeof first === 'string' && first.includes('[svelte] hydration')) {
				const p = parse_svelte_warning(args.filter((a) => typeof a === 'string').join('\n'));
				if (p) {
					const fp = hydrating?.getAttribute(OG_FP) ?? undefined;
					log.add({ ...p, ...(fp ? { fp } : {}), t: Math.round(clock.mono() * 10) / 10 });
				}
			}
		} catch {
			// ok: reading a warning never breaks the console line it came in
		}
		return warn.apply(this, args as []);
	};
}
