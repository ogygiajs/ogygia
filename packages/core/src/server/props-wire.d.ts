import { type SeedIndex } from '../seed-refs.ts';
/** The sidecar attribute naming a non-devalue payload format; absent = devalue. */
export declare const WIRE_FORMAT_ATTR = "data-og-format";
/** The one non-devalue format: plain JSON, read with `JSON.parse`. */
export declare const WIRE_FORMAT_JSON = "json";
/** On a props sidecar: the transportable classes its props carry (tag paths, space-separated) —
 *  what the browser loads before it decodes them. */
export declare const WIRE_CLASSES_ATTR = "data-og-wire";
/**
 * devalue-serialize an island's props with the prop families' reducers, plus the seed-reference
 * reducer when the caller has one. Throws a teaching error on a non-serializable prop.
 */
export declare function stringify_props(value: unknown, entry: string, seed_refs?: ((v: unknown) => unknown) | null, 
/** collects the tag path (the part before `#`) of every transportable class these props carry */
wire_out?: Set<string> | null): string;
/** A sidecar's text and the lane it is in. */
export interface WireText {
    text: string;
    json: boolean;
}
export interface PropsWire {
    /** The canonical, seed-independent text — what the fingerprint hashes. */
    readonly canonical: string;
    /** Whether the canonical text is plain JSON (the lane the props qualify for). */
    readonly json: boolean;
    /** Live region-snippet entry URLs riding in these props (the preloads they need). Only a
     *  devalue payload can carry one — a live snippet is a branded function, never plain JSON. */
    readonly live_entries: readonly string[];
    /** The transportable classes these props carry, by tag path (root-relative module): the browser
     *  loads just these before decoding (it no longer loads every transportable up front). */
    readonly wire_modules: readonly string[];
    /** The sidecar text for the wire. `seed` is the page seed's index when the seed ships (then a
     *  props subtree that is a seed node crosses as a reference), `null` when it does not. */
    wire(seed: SeedIndex | null): WireText;
    /** The references the LAST `wire()` wrote: how many, into which top-level `page.data` keys. */
    readonly refs: {
        count: number;
        keys: readonly string[];
    };
    /** Why the canonical text is not JSON (the first disqualifying leaf); `null` on the JSON lane.
     *  A separate walk, run on demand — the profiler's explainer, never the render path. */
    culprit(): string | null;
}
/**
 * Plan an island's sidecar: lane, canonical text, live snippet entries — and a `wire(seed)` that
 * produces the final text once the request knows about the seed (the document tail's render).
 * The wire text is produced once per seed: identical islands share one plan, and a tail rendered
 * twice against the same index (a test, a re-render) plans and serializes once.
 */
export declare function plan_props_wire(value: unknown, entry: string): PropsWire;
/** Where a sidecar sits: the document tail (one per fingerprint for the page) or next to its region. */
export type SidecarPlace = 'tail' | 'adjacent';
/**
 * The sidecar `<script>` for one island: keyed by fingerprint when it has one (`data-ogygia-props`
 * for the reconciler; in the TAIL also `id`, for an O(1) `getElementById` lookup by the runtime),
 * unkeyed otherwise; the format attribute names the JSON lane.
 */
export declare function props_sidecar(fp: string, w: WireText, place?: SidecarPlace, wire_modules?: readonly string[]): string;
