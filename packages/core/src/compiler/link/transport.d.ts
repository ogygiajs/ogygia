/**
 * `virtual:ogygia/transport` emitter — re-exports the app's universal `transport` hook (or an empty
 * map) for the client remote wire codec. Universal hooks are isomorphic, so this is client-safe.
 * Pure over the resolved absolute path to the app's universal hooks module (or null).
 */
export declare function transport_module(universal_hooks: string | null, kit_codec?: string | null): string;
/**
 * `virtual:ogygia/kit-transport` emitter — the value behind the barrel's `ogygia.transport` (the Kit
 * `transport` hook the app spreads into its universal hooks). GENERATED per-app, not a fixed export:
 * the real `ogygiaTransport` statically pulls the whole codec cluster (wire/store/snippet/fn + region,
 * ~9 kB) since a wired value can nest any other kind. A **pure-island** app crosses NOTHING through
 * Kit's transport, so it gets an empty map and never bundles a decoder it can't use. `app_crosses_wire`
 * is the compiler's own knowledge (a transportable class / portable snippet → the `wire` mark, plus a
 * remote file or a `region`/content import) — never a scan for `ogygia.transport` in app source.
 * `transport_spec` is the resolvable path to ogygia's own `transport.js` (dist).
 */
export declare function kit_transport_module(app_crosses_wire: boolean, transport_spec: string): string;
/** True when `src` produces a held region / transportable value that can cross Kit's `transport`. */
export declare function source_crosses_wire(src: string): boolean;
/**
 * `virtual:ogygia/transportables` emitter — where the `[ogygia.wire]` codecs come from, so an island
 * receiving a transportable prop never has to import the class itself. Per leg:
 * - SERVER: side-effect-imports every module that defines a transportable class (the region endpoint
 *   decodes signed props of any island; loaded once per process).
 * - CLIENT: NO eager import — every island page used to download every transportable class of the
 *   app. It exports `wire_loaders`, a class module's tag path (root-relative, the part of a tag
 *   before `#`) → a lazy import; the runtime loads just the ones an island's props carry (the server
 *   stamps them on its props sidecar) before it decodes them.
 * `modules` is the Program's set of transportable module paths (absolute); `rel` makes a tag path.
 */
export declare function transportables_module(modules: Iterable<string>, ssr: boolean, rel: (abs: string) => string, 
/** the app sends wired values through Kit's `transport` (remote functions, loads): those decode
 *  synchronously, whenever they arrive — every class must be in before any island wakes */
crosses_wire?: boolean): string;
