// Shared page store for `$app/state` + `$app/stores` island shims.
//
// Module singleton (runtime + shims share one client chunk). Fields are `$state.raw` like Kit —
// deep `$state` breaks `URL` (and Date/Map in `data`). Runtime converts the devalue href string
// to a `URL` before `set_page`; we only guard non-URL leftovers.

export interface PageSnapshot {
	url: URL;
	params: Record<string, string>;
	route: { id: string | null };
	status: number;
	data: Record<string, unknown>;
	form: unknown;
	error: { message: string } | null;
	state: Record<string, unknown>;
}

const FALLBACK: PageSnapshot = {
	url: typeof location !== 'undefined' ? new URL(location.href) : new URL('http://localhost/'),
	params: {},
	route: { id: null },
	status: 200,
	data: {},
	form: null,
	error: null,
	state: {}
};

export class PageState {
	url: URL = $state.raw(FALLBACK.url);
	params: Record<string, string> = $state.raw<Record<string, string>>(FALLBACK.params);
	route: { id: string | null } = $state.raw<{ id: string | null }>(FALLBACK.route);
	status: number = $state.raw(FALLBACK.status);
	data: Record<string, unknown> = $state.raw<Record<string, unknown>>(FALLBACK.data);
	form: unknown = $state.raw<unknown>(FALLBACK.form);
	error: { message: string } | null = $state.raw<{ message: string } | null>(FALLBACK.error);
	state: Record<string, unknown> = $state.raw<Record<string, unknown>>(FALLBACK.state);

	#subscribers = new Set<() => void>();

	set(snap: Partial<PageSnapshot> | undefined | null): void {
		const s = snap || FALLBACK;
		this.url = s.url instanceof URL ? s.url : FALLBACK.url;
		this.params = s.params ?? {};
		this.route = s.route ?? { id: null };
		this.status = s.status ?? 200;
		this.data = s.data ?? {};
		this.form = s.form ?? null;
		this.error = s.error ?? null;
		this.state = s.state ?? {};
		for (const fn of this.#subscribers) {
			try {
				fn();
			} catch (error) {
				// (a subscriber throwing must not stop the others, and is not dropped)
				report_thrown(error);
			}
		}
	}

	reset(): void {
		this.set({
			url: typeof location !== 'undefined' ? new URL(location.href) : FALLBACK.url,
			params: {},
			route: { id: null },
			status: 200,
			data: {},
			form: null,
			error: null,
			state: {}
		});
	}

	subscribe(fn: () => void): () => void {
		this.#subscribers.add(fn);
		return () => this.#subscribers.delete(fn);
	}
}

// One instance across EVERY bundle. In production the runtime and island entries share a single
// `page-store` chunk, so a module-local `new PageState()` was already a singleton — but `vite dev`
// serves this module as two instances (the runtime imports it relatively; islands reach it through
// the `$app/state` alias, a different resolved URL), so `set_page()`/`reset_page()` from the runtime
// updated one instance while an island read the other → stale `page.url`/`params` after SPA nav
// (e.g. a sidebar's active link stuck on the old page in dev). A `globalThis` + `Symbol.for` handle
// is one instance regardless of how many times the module is evaluated. PAGE-STATE-SINGLETON.
import { foreign_hydrate } from '../current-region.ts';
import { warn } from '../messages/island.ts';

/** report-thrown.ts's `report_thrown`, here in full: island-side code never imports a module the
 *  runtime's boot imports (runtime-boot-svelte-free.test.ts), and the boot's ref watchers use it. */
function report_thrown(error: unknown): void {
	const report = (globalThis as { reportError?: (e: unknown) => void }).reportError;
	if (typeof report === 'function') report(error);
	else console.error(error);
}

const PAGE_STATE_KEY = Symbol.for('ogygia.page-state');
const global_scope = globalThis as unknown as Record<symbol, PageState | undefined>;
export const page_state: PageState = (global_scope[PAGE_STATE_KEY] ??= new PageState());

/** Seed from an island's SSR snapshot (pre-hydration / SPA remount). */
export function set_page(snap: Partial<PageSnapshot> | undefined | null): void {
	page_state.set(snap);
}

/** Reset to location-based fallback between SPA body swaps (clears stale route data). */
export function reset_page(): void {
	page_state.reset();
}

export function subscribe_page(fn: () => void): () => void {
	return page_state.subscribe(fn);
}

// FOREIGN PAGE READ (dev warning, fragment federation). Inside a mounted MFE island this store is
// the SHELL's: one singleton per document, seeded from the shell's page script — the MFE's own seed
// sits in its `<head>`, which the fragment boundary drops. So a read of page.data / params / route
// / form / error during that island's hydrate sees the shell's values, while the island's SSR HTML
// was rendered with the MFE's own load: it will repaint with different values (often `undefined`).
// The shell runtime marks the foreign hydrate (`set_foreign_hydrate`); this warns once per island
// entry. `page.url` / `status` / `state` stay silent — the URL is the same on both sides.
// The once-set lives on `globalThis` for the same reason `page_state` does (PAGE-STATE-SINGLETON):
// `vite dev` evaluates this module more than once per document, and a module-local set printed
// the same island twice.
// (.v2: the slot holds a capped record now; a copy of another version keeps its own)
const WARNED_FOREIGN_KEY = Symbol.for('ogygia.foreign-page-warned.v2');
/** The islands a foreign page read was said for (an island-side module: it imports nothing of the
 *  boot, so a record of its own, capped: past the cap a read is said again, never held). */
class WarnedReads {
	static readonly MAX = 1000;
	readonly entries = new Set<string>();
	has(entry: string): boolean {
		return this.entries.has(entry);
	}
	set(entry: string, _said: true): void {
		if (this.entries.size >= WarnedReads.MAX) this.entries.clear();
		this.entries.add(entry);
	}
}
const warned_foreign_entries: WarnedReads = ((
	globalThis as unknown as Record<symbol, WarnedReads | undefined>
)[WARNED_FOREIGN_KEY] ??= new WarnedReads());
export function warn_foreign_page_read(expr: string): void {
	if (!import.meta.env.DEV) return;
	const f = foreign_hydrate();
	if (!f || warned_foreign_entries.has(f.entry)) return;
	warned_foreign_entries.set(f.entry, true);
	warn('foreign_page_read', { expr, entry: f.entry, origin: f.origin });
}
