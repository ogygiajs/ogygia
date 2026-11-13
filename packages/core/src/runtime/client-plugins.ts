import type { ClientPlugin } from '../plugin/client.ts';
import type { RuntimeHookName, RuntimeHooks } from '../contract/runtime-hooks.ts';
import { slots } from './slots.ts';
import { OgygiaError } from '../messages/core.ts';

export const CLIENT_PLUGINS: boolean =
	typeof __OGYGIA_CLIENT_PLUGINS__ !== 'undefined' ? __OGYGIA_CLIENT_PLUGINS__ : false;

export const HOOK_REGION_MOUNT: boolean =
	typeof __OGYGIA_HOOK_REGION_MOUNT__ !== 'undefined' ? __OGYGIA_HOOK_REGION_MOUNT__ : true;
export const HOOK_REGION_UNMOUNT: boolean =
	typeof __OGYGIA_HOOK_REGION_UNMOUNT__ !== 'undefined' ? __OGYGIA_HOOK_REGION_UNMOUNT__ : true;
export const HOOK_REGION_HYDRATE: boolean =
	typeof __OGYGIA_HOOK_REGION_HYDRATE__ !== 'undefined' ? __OGYGIA_HOOK_REGION_HYDRATE__ : true;
export const HOOK_ANSWER_PARSED: boolean =
	typeof __OGYGIA_HOOK_ANSWER_PARSED__ !== 'undefined' ? __OGYGIA_HOOK_ANSWER_PARSED__ : true;
export const HOOK_ANSWER_PLACED: boolean =
	typeof __OGYGIA_HOOK_ANSWER_PLACED__ !== 'undefined' ? __OGYGIA_HOOK_ANSWER_PLACED__ : true;
export const HOOK_REGION_HYDRATED: boolean =
	typeof __OGYGIA_HOOK_REGION_HYDRATED__ !== 'undefined' ? __OGYGIA_HOOK_REGION_HYDRATED__ : true;
export const HOOK_REGION_FAILED: boolean =
	typeof __OGYGIA_HOOK_REGION_FAILED__ !== 'undefined' ? __OGYGIA_HOOK_REGION_FAILED__ : true;
export const HOOK_REGION_WOKE: boolean =
	typeof __OGYGIA_HOOK_REGION_WOKE__ !== 'undefined' ? __OGYGIA_HOOK_REGION_WOKE__ : true;
export const HOOK_REGION_MISMATCHED: boolean =
	typeof __OGYGIA_HOOK_REGION_MISMATCHED__ !== 'undefined'
		? __OGYGIA_HOOK_REGION_MISMATCHED__
		: true;
export const HOOK_HOLE_ANSWERED: boolean =
	typeof __OGYGIA_HOOK_HOLE_ANSWERED__ !== 'undefined' ? __OGYGIA_HOOK_HOLE_ANSWERED__ : true;
export const HOOK_HOLE_FAILED: boolean =
	typeof __OGYGIA_HOOK_HOLE_FAILED__ !== 'undefined' ? __OGYGIA_HOOK_HOLE_FAILED__ : true;
export const HOOK_HOLE_BATCH_MISSED: boolean =
	typeof __OGYGIA_HOOK_HOLE_BATCH_MISSED__ !== 'undefined'
		? __OGYGIA_HOOK_HOLE_BATCH_MISSED__
		: true;
export const HOOK_ENTRY_FALLBACK: boolean =
	typeof __OGYGIA_HOOK_ENTRY_FALLBACK__ !== 'undefined' ? __OGYGIA_HOOK_ENTRY_FALLBACK__ : true;
export const HOOK_NAV_STARTED: boolean =
	typeof __OGYGIA_HOOK_NAV_STARTED__ !== 'undefined' ? __OGYGIA_HOOK_NAV_STARTED__ : true;
export const HOOK_NAVIGATED: boolean =
	typeof __OGYGIA_HOOK_NAVIGATED__ !== 'undefined' ? __OGYGIA_HOOK_NAVIGATED__ : true;
export const HOOK_CRITICAL_SETTLED: boolean =
	typeof __OGYGIA_HOOK_CRITICAL_SETTLED__ !== 'undefined' ? __OGYGIA_HOOK_CRITICAL_SETTLED__ : true;
export const HOOK_LOAD_STARTED: boolean =
	typeof __OGYGIA_HOOK_LOAD_STARTED__ !== 'undefined' ? __OGYGIA_HOOK_LOAD_STARTED__ : true;
export const HOOK_WARNING: boolean =
	typeof __OGYGIA_HOOK_WARNING__ !== 'undefined' ? __OGYGIA_HOOK_WARNING__ : true;

/** A plugin's browser half, with the plugin's name, as the boot entry hands it over. */
export interface ClientRealm {
	readonly name: string;
	readonly client: ClientPlugin;
}

type Payload<K extends RuntimeHookName> = Parameters<RuntimeHooks[K]>[0];

function isolated(hook: RuntimeHookName | 'boot'): (plugin: string, run: () => unknown) => unknown {
	const failed = new Set<string>();
	const report = (plugin: string, err: unknown) => {
		if (failed.has(plugin)) return;
		failed.add(plugin);
		console.error(new OgygiaError('client_hook_failed', { plugin, hook }), err);
	};
	return (plugin, run) => {
		try {
			const out = run();
			if (typeof (out as PromiseLike<unknown> | undefined)?.then === 'function')
				Promise.resolve(out).catch((err: unknown) => report(plugin, err));
			return out;
		} catch (err) {
			report(plugin, err);
		}
	};
}

function joined<K extends RuntimeHookName>(
	list: readonly ClientRealm[],
	name: K
): RuntimeHooks[K] | undefined {
	const subscribers: { plugin: string; f: (e: Payload<K>) => unknown }[] = [];
	for (const { name: plugin, client } of list) {
		const f = client.hooks?.[name] as ((e: Payload<K>) => unknown) | undefined;
		if (f) subscribers.push({ plugin, f });
	}
	if (!subscribers.length) return undefined;
	const call = isolated(name);
	return ((e: Payload<K>) => {
		if (import.meta.env.DEV) Object.freeze(e);
		let afters: { plugin: string; f: () => unknown }[] | undefined;
		for (const { plugin, f } of subscribers) {
			const out = call(plugin, () => f(e));
			if (typeof out === 'function') (afters ??= []).push({ plugin, f: out as () => unknown });
		}
		if (afters) {
			const all = afters;
			return () => {
				for (const a of all) call(a.plugin, a.f);
			};
		}
	}) as RuntimeHooks[K];
}

/** Subscribe each plugin's hooks, then boot each plugin's browser half (the runtime's boot, or a
 *  Kit-owned page's). */
export function boot_client_plugins(list: readonly ClientRealm[], kit_page: boolean): void {
	if (
		HOOK_REGION_MOUNT ||
		HOOK_REGION_UNMOUNT ||
		HOOK_REGION_HYDRATE ||
		HOOK_ANSWER_PARSED ||
		HOOK_ANSWER_PLACED ||
		HOOK_REGION_HYDRATED ||
		HOOK_REGION_FAILED ||
		HOOK_REGION_WOKE ||
		HOOK_REGION_MISMATCHED ||
		HOOK_HOLE_ANSWERED ||
		HOOK_HOLE_FAILED ||
		HOOK_HOLE_BATCH_MISSED ||
		HOOK_ENTRY_FALLBACK ||
		HOOK_NAV_STARTED ||
		HOOK_NAVIGATED ||
		HOOK_CRITICAL_SETTLED ||
		HOOK_LOAD_STARTED ||
		HOOK_WARNING
	) {
		const h: Partial<RuntimeHooks> = {};
		if (HOOK_REGION_MOUNT) h.regionMount = joined(list, 'regionMount');
		if (HOOK_REGION_UNMOUNT) h.regionUnmount = joined(list, 'regionUnmount');
		if (HOOK_REGION_HYDRATE) h.regionHydrate = joined(list, 'regionHydrate');
		if (HOOK_ANSWER_PARSED) h.answerParsed = joined(list, 'answerParsed');
		if (HOOK_ANSWER_PLACED) h.answerPlaced = joined(list, 'answerPlaced');
		if (HOOK_REGION_HYDRATED) h.regionHydrated = joined(list, 'regionHydrated');
		if (HOOK_REGION_FAILED) h.regionFailed = joined(list, 'regionFailed');
		if (HOOK_REGION_WOKE) h.regionWoke = joined(list, 'regionWoke');
		if (HOOK_REGION_MISMATCHED) h.regionMismatched = joined(list, 'regionMismatched');
		if (HOOK_HOLE_ANSWERED) h.holeAnswered = joined(list, 'holeAnswered');
		if (HOOK_HOLE_FAILED) h.holeFailed = joined(list, 'holeFailed');
		if (HOOK_HOLE_BATCH_MISSED) h.holeBatchMissed = joined(list, 'holeBatchMissed');
		if (HOOK_ENTRY_FALLBACK) h.entryFallback = joined(list, 'entryFallback');
		if (HOOK_NAV_STARTED) h.navStarted = joined(list, 'navStarted');
		if (HOOK_NAVIGATED) h.navigated = joined(list, 'navigated');
		if (HOOK_CRITICAL_SETTLED) h.criticalSettled = joined(list, 'criticalSettled');
		if (HOOK_LOAD_STARTED) h.loadStarted = joined(list, 'loadStarted');
		if (HOOK_WARNING) h.warning = joined(list, 'warning');
		slots.hooks = h;
	}
	const boot = isolated('boot');
	for (const { name, client } of list)
		if (client.boot) boot(name, () => client.boot?.({ kitPage: kit_page }));
}

/** A region's component started in the browser: its entry, and the files it runs from. */
export function client_region_mount(el: Element): void {
	const mount = slots.hooks?.regionMount;
	const entry = el.getAttribute('entry');
	if (!mount || !entry) return;
	mount({ el, entry, urls: region_urls(el, entry) });
}

/** Svelte is about to hydrate over `el`: the subscribers' afters, as one (null when none). The
 *  hydrate core reaches it through the boot link. */
export function client_region_hydrate(el: Element): (() => void) | null {
	return slots.hooks?.regionHydrate?.({ el }) ?? null;
}

function region_urls(el: Element, entry: string): string[] {
	const urls: string[] = [];
	for (const u of [entry, el.getAttribute('src')]) {
		try {
			if (u) urls.push(new URL(u, document.baseURI).href);
		} catch {
			// ok: not a URL, so not a script of the page
		}
	}
	return urls;
}
