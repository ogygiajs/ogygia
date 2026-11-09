import { type DevtoolsEvent } from './schema.ts';
/** The global the {@link install_window_sink window sink} publishes. Distinct from the compile-time
 *  `__OGYGIA_DEVTOOLS__` define (a bare identifier the bundler replaces) — this is a real runtime
 *  object on `window`, read by Playwright `page.evaluate` across the script boundary. */
declare const WINDOW_HOOK = "__ogygia_devtools";
/** Shape of `window.__ogygia_devtools` (the e2e / instrument entry point). */
export interface DevtoolsWindowHook {
    /** Schema version, so a reader can gate. */
    version: number;
    /** Every buffered event, oldest → newest (a fresh copy each call). */
    events(): DevtoolsEvent[];
    /** Subscribe to events from now on; returns an unsubscribe fn. */
    on(cb: (event: DevtoolsEvent) => void): () => void;
    /** Drop the buffer (between e2e scenarios). */
    clear(): void;
    /** Serialize the buffer to a portable trace. */
    trace(): DevtoolsTrace;
}
declare global {
    interface Window {
        [WINDOW_HOOK]?: DevtoolsWindowHook;
    }
}
/**
 * Publish `window.__ogygia_devtools` so an out-of-page reader (Playwright, a devtools panel, a REPL
 * host) can pull buffered events, subscribe to new ones, and drain a trace — WITHOUT importing any
 * framework module. Idempotent. No-op off the browser. Returns the hook (or undefined on the server).
 *
 * This is what lets our e2e assert on the ISLAND LIFECYCLE directly ("interaction island fired its
 * wake, replayed exactly one click") instead of polling the DOM behind a `waitForTimeout` — the
 * bus pays for itself in our own tests first (the note's proof-of-value).
 */
export declare function install_window_sink(): DevtoolsWindowHook | undefined;
/**
 * Forward every event to a `postMessage` target (the REPL's tab ↔ worker ↔ iframe channel). Pass a
 * `Worker` / `MessagePort` / `Window`; each event is posted as `{ __ogygia_devtools: event }`.
 * Returns the unregister fn.
 */
export declare function install_postmessage_sink(target: {
    postMessage: (message: unknown) => void;
}): () => void;
/** Log every event to the console (debugging). `filter` limits by domain/name substring. */
export declare function install_console_sink(filter?: (event: DevtoolsEvent) => boolean): () => void;
/** A portable trace — a versioned bag of events, attachable to a bug report and replayable in the
 *  REPL later (the note's "CPU-profile energy, but for the islands lifecycle"). */
export interface DevtoolsTrace {
    /** Marker so a consumer knows what it's holding. */
    kind: 'ogygia-devtools-trace';
    /** {@link DEVTOOLS_SCHEMA_VERSION}. */
    version: number;
    /** Events in emission order. */
    events: DevtoolsEvent[];
}
/** Serialize the current buffer into a {@link DevtoolsTrace}. */
export declare function to_trace(): DevtoolsTrace;
/**
 * Read the server realm's `<script type="application/ogygia-devtools">` side-channel (injected by the
 * handle on a devtools build) and INGEST its events into the unified stream, so a region's server
 * render sits in the same `window.__ogygia_devtools` timeline as its client wake — correlated by
 * fingerprint. Idempotent per document via a marker attribute; no-op off the browser or when the
 * script is absent. Returns how many server events were ingested.
 */
export declare function ingest_server_events(): number;
export {};
