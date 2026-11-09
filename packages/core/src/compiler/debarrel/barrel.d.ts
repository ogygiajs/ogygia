import { type ModuleShape } from './parse.ts';
/** `Caller`: who asked for the map (`map(id, spec, caller)`), handed to every resolve of its walk —
 *  the Vite plugin's transform context, whose own `resolve` knows its environment's conditions. */
export interface Host<Caller = void> {
    /** The module's source, or null when it cannot be read (virtual, binary, missing). */
    read(id: string): string | null;
    /** Resolve `spec` from `importer` to a file id, as `caller` resolves it; null when Vite cannot. */
    resolve(spec: string, importer: string, caller: Caller): Promise<string | null>;
    /** May this resolved module be treated as a barrel at all? (matchers + node_modules policy) */
    candidate(id: string, spec: string): boolean;
    /** Is this module forced even though impure? */
    forced(id: string, spec: string): boolean;
    /** Is this module kept whatever it looks like? */
    kept(id: string, spec: string): boolean;
    /** Follow a star into node_modules? */
    follow_packages: boolean;
}
export type Leaf = 
/** `import { name } from id` (or `import local from id` when name is `default`) */
{
    id: string;
    name: string;
}
/** `import * as local from id` */
 | {
    id: string;
    namespace: true;
};
export type Entry = Leaf | 'own' | 'ambiguous';
export interface ExportMap {
    id: string;
    /** the barrel's usable names */
    entries: Map<string, Entry>;
    /** pure barrel → the import can be dropped once every name moved; impure → kept for effects */
    pure: boolean;
    /** rewriting allowed at all (candidate, and pure or forced, and not kept) */
    rewritable: boolean;
    /** some names could not be seen (a star into the unparsable): unknown names stay on the barrel */
    opaque: boolean;
    /** every module this map depends on — a change to any of them invalidates the map */
    deps: Set<string>;
    /** built while a neighbour was still being built by another walk: served, not cached */
    provisional: boolean;
    /** ids on the walk stack this build ran into (a cycle): the map lacks THEIR names, so it is
     *  cached only once the walk that owns them has closed the ring (the set is empty there) */
    cycles: Set<string>;
}
/** One index caches the maps its callers' walks built, so every caller of one index must resolve
 *  alike: the Vite plugin keeps one index per environment (a leaf may resolve to another file for
 *  the client than for the server). */
export declare class BarrelIndex<Caller = void> {
    #private;
    constructor(host: Host<Caller>);
    /** Drop every cached map/shape that depends on `id` (the file changed), and every build in flight
     *  that has met it so far (one it meets later reads the file as it is now). */
    invalidate(id: string): void;
    /** The parsed shape of a module (cached), or null when it cannot be read/parsed. */
    shape(id: string): ModuleShape | null;
    /**
     * The export map of a barrel, or null when the module is not a barrel the plugin may rewrite
     * (not a candidate, impure and not forced, kept, unreadable). `spec` is the specifier the
     * importer wrote — matchers see both. Concurrent callers share one build; a build resolves as
     * the `caller` that started it.
     */
    map(id: string, spec: string, caller: Caller): Promise<ExportMap | null>;
}
