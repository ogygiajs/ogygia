/**
 * The devtools EVENT BUS — the whole product's spine (internal/notes/devtools.md, Rung 0).
 *
 * `emit()` is the one entry point. Behind it: a capped RING BUFFER (so a long-lived tab / server
 * can't grow it unbounded) plus a set of pluggable SINKS (postMessage for the REPL, a window hook
 * for e2e, console for debugging, buffer→JSON for traces). Nothing here has a UI opinion — every
 * product (our own e2e, the REPL, the future Vite plugin) is a listener over this.
 *
 * ZERO-COST WHEN OFF. `DEVTOOLS` is a compile-time constant from the `__OGYGIA_DEVTOOLS__` Vite
 * `define` (typeof-guarded exactly like `__OGYGIA_SERVER_DELTA__`, so a plain `node` import of
 * `dist/` without the define falls back to `false`). Call sites guard with a MODULE-LOCAL
 * `const DEVTOOLS = …` (the proven DCE pattern — see runtime/form-continuity.ts): when off, the
 * whole `if (DEVTOOLS) emit({…})` — object literal included — folds to `if (false)` and is dropped,
 * and this module, now unreferenced, tree-shakes out of the app's runtime chunk entirely.
 *
 * STATE IS GLOBAL-PINNED. The island runtime chunk, each island entry, and the transport-hook graph
 * are SEPARATE bundles that each carry their own copy of this module — but hub mints (ref.ts) and
 * region wakes (core.ts) emit from whichever copy runs. Pinning the buffer to `globalThis` (like the
 * hub registry and the frame store) keeps every copy writing into the ONE buffer a sink exposes.
 * No top-level side effect: the global is created lazily on first `emit`/`configure`, so an unused
 * import is fully shakeable.
 */
import { type DevtoolsEvent, type DevtoolsEventInput } from './schema.ts';
/** Compile-time gate (Vite `define`). Exported for the public surface + tests; seam modules declare
 *  their OWN local `const DEVTOOLS` from the same token so DCE never depends on cross-module folding. */
export declare const DEVTOOLS: boolean;
/** A sink is any consumer of stamped events. Throwing is contained — one bad sink never starves the
 *  others, and never breaks the framework path that emitted the event. */
export type DevtoolsSink = (event: DevtoolsEvent) => void;
/**
 * THE emit entry point. Stamps the envelope (v / seq / t / realm), rings the buffer, fans to sinks.
 * A no-op when the bus is inactive. Guard the CALL with a module-local `if (DEVTOOLS)` so the event
 * literal compiles out entirely when off — this internal guard only protects direct/dynamic callers.
 */
export declare function emit(input: DevtoolsEventInput): void;
/**
 * Push ALREADY-STAMPED events into the buffer + sinks WITHOUT re-stamping — the ingest path for the
 * server realm's events, which arrive from the `application/ogygia-devtools` side-channel carrying
 * their own envelope (v / seq / t / realm:'server'). This is what unifies the server render stream
 * and the client wake stream into ONE `window.__ogygia_devtools` timeline, correlated by fingerprint.
 */
export declare function ingest(events: DevtoolsEvent[]): void;
/** Buffered events in emission order (oldest → newest). Copies out — safe to hold/serialize. */
export declare function snapshot(): DevtoolsEvent[];
/** Drop every buffered event (the sinks are left registered). Used between e2e scenarios + traces. */
export declare function clear(): void;
/** Register a sink; returns an unregister fn. A sink sees events from registration onward — to also
 *  replay what's buffered, iterate {@link snapshot} first. */
export declare function add_sink(sink: DevtoolsSink): () => void;
/** Runtime configuration — pause/resume, resize the ring, set per-name sampling. */
export declare function configure(opts: {
    active?: boolean;
    cap?: number;
    sample?: Record<string, number>;
}): void;
