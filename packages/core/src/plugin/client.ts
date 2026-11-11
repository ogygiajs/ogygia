/**
 * `ogygia/plugin/client` — the BROWSER realm of a plugin (design: internal/notes/packages.md, plugin
 * API v2). A plugin package exports `./client`; its default export is `defineClient({ … })`. The
 * build finds it by the plugin's name and imports it statically into the runtime's boot entry, so it
 * ships to every page the runtime boots on. Keep it small: it is in the boot's static graph — load
 * anything heavy with a dynamic import of its own, on demand.
 *
 *   export default defineClient({
 *     boot({ kitPage }) { … },                     // once, as the runtime boots (before any region wakes)
 *     hooks: {
 *       regionMount({ el, entry, urls }) { … },    // a region's component started in the browser
 *       regionHydrate({ el }) { return () => { … } }, // around Svelte's hydrate over server markup
 *       answerParsed({ fragment }) { … },          // a region answer parsed, before anything reads it
 *       regionHydrated({ el, t0, tDone }) { … }    // …and the rest of RuntimeHooks
 *     }
 *   });
 *
 * The build reads the `hooks` keys from the file, so `hooks` is an object literal written in the
 * `defineClient` call. A hook nobody subscribes to folds out of the runtime entirely. Hooks are
 * called as plain functions (no `this`).
 */
import type { RuntimeHooks } from '../contract/runtime-hooks.ts';

export type {
	AnswerParsedEvent,
	AnswerPlacedEvent,
	CriticalOutcome,
	CriticalSettledEvent,
	EntryFallbackEvent,
	HoleAnsweredEvent,
	HoleBatchMissedEvent,
	HoleFailedEvent,
	HoleRefusal,
	NavigatedEvent,
	RegionFailedEvent,
	RegionHydrateEvent,
	RegionHydratedEvent,
	RegionMountEvent,
	RegionUnmountEvent,
	RuntimeHookName,
	RuntimeHooks,
	WarningEvent
} from '../contract/runtime-hooks.ts';

/** What `boot` is told about the page. */
export interface ClientBootContext {
	/** A page Kit hydrates (csr = true): ogygia's runtime does not boot there and no region hook
	 *  fires; the realm boots on its own (dev only). */
	readonly kitPage: boolean;
}

/** A plugin's browser half. */
export interface ClientPlugin {
	/** Once, as the runtime boots: after core's features, before the first region wakes. */
	boot?(ctx: ClientBootContext): void;
	/** The runtime moments this plugin subscribes to. */
	hooks?: Partial<RuntimeHooks>;
}

/** Typed identity: a plugin's browser half. */
export function defineClient(plugin: ClientPlugin): ClientPlugin {
	return plugin;
}
