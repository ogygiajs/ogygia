/** A region's component started in the browser (hydrated, or mounted live). */
export interface RegionMountEvent {
	readonly el: Element;
	/** the region's entry (its component's stable module URL) */
	readonly entry: string;
	/** the files it runs from */
	readonly urls: readonly string[];
}

/** A region's component left the page. */
export interface RegionUnmountEvent {
	readonly el: Element;
	readonly entry: string;
}

/** A region hydrated: when it woke, when its modules were in hand, when its scheduler turn began
 *  and when `data-hydrated` was set (page time, ms), with the markup the server sent. */
export interface RegionHydratedEvent {
	readonly el: Element;
	readonly t0: number;
	readonly tLoaded: number;
	readonly tTurn?: number;
	readonly tDone: number;
	readonly ssrHtml?: string | null;
}

/** A region failed to hydrate. */
export interface RegionFailedEvent {
	readonly el: Element;
	readonly message: string;
	readonly since: number;
	readonly turn?: number;
}

/** A hole's first answer replaced its fallback. `batch`: it came in a batch request of `size`
 *  holes that left at `left` and whose part for this hole landed `at`. */
export interface HoleAnsweredEvent {
	readonly el: Element;
	readonly start: number;
	readonly batch?: { readonly left: number; readonly at: number; readonly size: number };
}

/** Why a hole's answer was refused: it was redirected, came back as a document, or forbidden. */
export type HoleRefusal = 'redirected' | 'document' | 'forbidden';

/** A hole whose answer never came (no retry after). */
export interface HoleFailedEvent {
	/** the hole's island id (its endpoint's `?id=`) */
	readonly id: string;
	readonly reason: HoleRefusal | 'error';
	/** what answered instead, as a path (a refused answer) */
	readonly finalPath?: string;
	/** the error's first line (a failed request), or the server's reason (a refused capability) */
	readonly message?: string;
	readonly attempts: number;
	readonly t: number;
}

/** A batch request that carried fewer holes than it was sent for. */
export interface HoleBatchMissedEvent {
	readonly sent: number;
	readonly delivered: number;
	readonly status: number;
	readonly refused?: 'redirected' | 'document';
	readonly finalUrl?: string;
	/** the holes' endpoints */
	readonly endpoints: readonly string[];
}

/** A region whose location failed to load and fell back to its identity fetched fresh. */
export interface EntryFallbackEvent {
	/** the identity (the stable URL) */
	readonly entry: string;
	/** the location that failed */
	readonly src: string;
	/** the fresh identity loaded (false: that failed too) */
	readonly recovered: boolean;
}

/** An in-app navigation, timed by the router (page time, ms). */
export interface NavigatedEvent {
	readonly from: string;
	readonly to: string;
	readonly type: string;
	readonly t: number;
	readonly fetched: number;
	readonly styled: number;
	readonly swapped: number;
	/** the page's address as fetched */
	readonly href?: string;
}

/** A Svelte hydration warning (dev): the server and the browser disagreed. */
export interface WarningEvent {
	readonly code: string;
	readonly message: string;
	readonly file?: string;
	readonly fp?: string;
	readonly t: number;
}

/** How the critical-resources wait ended: they `arrived` (or failed), the visitor's first `input`,
 *  the `cap`, or `none` were pending. */
export type CriticalOutcome = 'arrived' | 'input' | 'cap' | 'none';

/** The critical-resources wait settled: the region downloads it held back may start. */
export interface CriticalSettledEvent {
	readonly outcome: CriticalOutcome;
	/** how many critical resources it waited on */
	readonly resources: number;
	readonly waitedMs: number;
}

/** Svelte is about to hydrate a component over `el`'s server markup. */
export interface RegionHydrateEvent {
	readonly el: Element;
}

/** A region answer (a hole, a lake remount, a router swap) was parsed: `fragment` is inert, and
 *  nothing has read it yet. */
export interface AnswerParsedEvent {
	readonly fragment: DocumentFragment;
}

/** A parsed answer went into the page: `el` is the region it went into. */
export interface AnswerPlacedEvent {
	readonly el: Element;
}

/** The runtime's moments a plugin's browser half can subscribe to (`defineClient({ hooks })`).
 *  Every hook is told with an event object of its own (a recorder dedupes by it). A
 *  hook is told; only `regionHydrate` answers: the function it returns runs right after the hydrate. */
export interface RuntimeHooks {
	regionMount(e: RegionMountEvent): void;
	regionUnmount(e: RegionUnmountEvent): void;
	regionHydrate(e: RegionHydrateEvent): (() => void) | void;
	answerParsed(e: AnswerParsedEvent): void;
	answerPlaced(e: AnswerPlacedEvent): void;
	regionHydrated(e: RegionHydratedEvent): void;
	regionFailed(e: RegionFailedEvent): void;
	holeAnswered(e: HoleAnsweredEvent): void;
	holeFailed(e: HoleFailedEvent): void;
	holeBatchMissed(e: HoleBatchMissedEvent): void;
	entryFallback(e: EntryFallbackEvent): void;
	navigated(e: NavigatedEvent): void;
	criticalSettled(e: CriticalSettledEvent): void;
	warning(e: WarningEvent): void;
}

export type RuntimeHookName = keyof RuntimeHooks;

/** Each hook's build constant: on only when a plugin's browser half subscribes to it. */
export const RUNTIME_HOOK_CONSTANTS: { readonly [K in RuntimeHookName]: string } = {
	regionMount: '__OGYGIA_HOOK_REGION_MOUNT__',
	regionUnmount: '__OGYGIA_HOOK_REGION_UNMOUNT__',
	regionHydrate: '__OGYGIA_HOOK_REGION_HYDRATE__',
	answerParsed: '__OGYGIA_HOOK_ANSWER_PARSED__',
	answerPlaced: '__OGYGIA_HOOK_ANSWER_PLACED__',
	regionHydrated: '__OGYGIA_HOOK_REGION_HYDRATED__',
	regionFailed: '__OGYGIA_HOOK_REGION_FAILED__',
	holeAnswered: '__OGYGIA_HOOK_HOLE_ANSWERED__',
	holeFailed: '__OGYGIA_HOOK_HOLE_FAILED__',
	holeBatchMissed: '__OGYGIA_HOOK_HOLE_BATCH_MISSED__',
	entryFallback: '__OGYGIA_HOOK_ENTRY_FALLBACK__',
	navigated: '__OGYGIA_HOOK_NAVIGATED__',
	criticalSettled: '__OGYGIA_HOOK_CRITICAL_SETTLED__',
	warning: '__OGYGIA_HOOK_WARNING__'
};
