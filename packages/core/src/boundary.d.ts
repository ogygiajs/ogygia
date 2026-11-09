/**
 * Boundary classifier — guard layer of the transportable seam.
 *
 * When a context/prop value heads for an island boundary, this walks it and names, per leaf,
 * what will happen: cross free, auto-wire, warn, or refuse — WITH the path to the leaf. It
 * exists so a value that can't cross fails at BOUNDARY DISCOVERY with "context 'user' @
 * profile.avatarEl: live DOM node", instead of an island silently reading `undefined` in prod.
 *
 * Dev-only caller today: `serialize_provided_context` used to drop unbridgeable keys silently;
 * it now explains each drop. The classifier is pure and dependency-light (store detection is
 * by shape, DOM by nodeType) so it costs nothing to import server-side.
 */
export interface BoundaryFinding {
    /** What the seam will do with this leaf. */
    kind: 'plain' | 'wire' | 'store' | 'warn' | 'refuse';
    /** Dot-path from the context value to the leaf (empty = the value itself). */
    path: string;
    /** One human sentence: what it is + what to do about it. */
    detail: string;
}
/** App-configurable secret policy (call once in hooks.server.ts). `allow` names keys/paths the
 *  sniff must NOT refuse (a false positive like 'tokenColor'); `deny` names ones it MUST refuse
 *  even when the regex misses (a semantic secret the shape can't reveal). Exact, case-sensitive
 *  matches against the context key or the finding path. */
export interface BoundaryPolicy {
    allow?: readonly string[];
    deny?: readonly string[];
}
export declare function configure_boundary(p: BoundaryPolicy): void;
/**
 * Classify one boundary value. `key` is the context key / prop name (used for secret sniffing
 * and in messages). Returns every finding, worst problems included — the caller decides
 * whether to warn (dev) or refuse (encode).
 */
export declare function classify_boundary(value: unknown, key?: string): BoundaryFinding[];
/** The findings that make a value undroppable-into-HTML (used to explain a dropped context key). */
export declare function boundary_problems(value: unknown, key?: string): BoundaryFinding[];
/**
 * The `import.meta.og.$` rewrite target for NON-function values — the universal boundary
 * assertion. Classifies the value AT THE MARK (creation), so a refusal (DOM node, bare
 * function, unwired class, secret) throws with the marked file:line instead of surfacing
 * deep inside a serializer at request time. Mark-don't-wrap: the value itself is returned
 * untouched — stores/classes/data keep their own passports; identity mints at the seam.
 */
export declare function __og_boundary<T>(value: T, site: string): T;
