/** A JSON value (what `args` and the data payloads carry). */
export type ScriptJson = string | number | boolean | null | ScriptJson[] | {
    [key: string]: ScriptJson | undefined;
};
/** The attributes every kind of inline script may carry. `true` renders a bare attribute;
 *  `false` / `null` / `undefined` leave it out. */
export interface ScriptAttrs {
    /** The element id (to find or replace the tag later). */
    id?: string;
    /** The page's CSP nonce, when its policy allows inline scripts by nonce. */
    nonce?: string;
    /** Any `data-*` attribute. */
    [data: `data-${string}`]: string | number | boolean | null | undefined;
}
type NoPayload = {
    json?: never;
    ld?: never;
    importmap?: never;
    speculation?: never;
};
type NoRun = {
    run?: never;
    args?: never;
    type?: never;
    async?: never;
    nomodule?: never;
    imports?: never;
};
/** What survives the JSON trip unchanged. A `Date` would arrive as a string, a `Map` / `Set` as
 *  `{}`, a function or class method not at all — those are `never`, so TypeScript refuses them. */
export type JsonSafe<T> = T extends string | number | boolean | null | undefined ? T : T extends bigint | symbol | ((...a: never[]) => unknown) | Date | RegExp | Map<unknown, unknown> | Set<unknown> ? never : {
    [K in keyof T]: JsonSafe<T[K]>;
};
/** `run`'s parameters as they may be passed: inferred from the call, each one JSON-safe. */
export type ScriptArgs<A extends unknown[]> = A & {
    [K in keyof A]: JsonSafe<A[K]>;
};
/** `args` is required exactly when `run` takes parameters. */
type RunArgs<A extends unknown[]> = A extends [] ? {
    args?: [];
} : {
    args: ScriptArgs<A>;
};
/**
 * A CLASSIC inline script (the default): runs where it stands, before the parser goes on — so in
 * `<head>` it runs before the first paint. (`async` / `defer` do nothing on an inline classic script,
 * so they are not offered: use `type: 'module'`.)
 */
export type ClassicScript<A extends unknown[]> = ScriptAttrs & NoPayload & {
    run: (...args: A) => unknown;
    type?: 'classic';
    /** Skip it in browsers that run modules (a fallback for very old ones). */
    nomodule?: boolean;
    async?: never;
    /** (static imports need a module: `type: 'module'`) */
    imports?: never;
} & RunArgs<A>;
/**
 * A MODULE inline script: its own scope, strict mode, `import()` available, and runs after the
 * document is parsed (the first paint does not wait for it — code that must apply before paint is a
 * classic script). An `async` `run` is awaited, so its rejection reports as the module's.
 * (`blocking="render"` is not offered: measured, it does not hold the paint for an inline module.)
 */
export type ModuleScript<A extends unknown[]> = ScriptAttrs & NoPayload & {
    run: (...args: A) => unknown;
    type: 'module';
    /** Run as soon as it is ready, without waiting for the document to finish parsing. */
    async?: boolean;
    nomodule?: never;
    imports?: never;
} & RunArgs<A>;
/** The module namespaces `imports` hands to `run`, by the names it declared. (Untyped: annotate the
 *  parameter — `({ carousel }: { carousel: typeof import('…') })` — when you have the module's types.) */
export type ScriptImports<I extends Record<string, string>> = {
    readonly [K in keyof I]: any;
};
/**
 * A MODULE inline script that needs modules: `imports` are written as static `import * as …` before
 * the call — data, not code, so no bundler rewrites them (an `import()` inside `run` would be: Vite's
 * SSR transform turns it into `__vite_ssr_dynamic_import__`, which the browser does not have). `run`
 * gets the namespaces as ONE object first, then `args`.
 */
export type ModuleImportsScript<I extends Record<string, string>, A extends unknown[]> = ScriptAttrs & NoPayload & {
    /** Name → URL of each module to import (an absolute or root-relative URL, or a specifier the
     *  page's import map resolves). */
    imports: I;
    run: (modules: ScriptImports<I>, ...args: A) => unknown;
    type: 'module';
    async?: boolean;
    nomodule?: never;
} & RunArgs<A>;
/** `<script type="application/json">` — data for code on the page to read (`JSON.parse(el.textContent)`). */
export type JsonScript = ScriptAttrs & NoRun & {
    json: ScriptJson;
    ld?: never;
    importmap?: never;
    speculation?: never;
};
/** `<script type="application/ld+json">` — structured data for search engines. */
export type LdScript = ScriptAttrs & NoRun & {
    ld: ScriptJson;
    json?: never;
    importmap?: never;
    speculation?: never;
};
/** `<script type="importmap">` — bare specifiers for the page's module scripts. */
export type ImportMapScript = ScriptAttrs & NoRun & {
    importmap: {
        imports?: Record<string, string>;
        scopes?: Record<string, Record<string, string>>;
        integrity?: Record<string, string>;
    };
    json?: never;
    ld?: never;
    speculation?: never;
};
/** `<script type="speculationrules">` — the pages the browser may prefetch or prerender. */
export type SpeculationScript = ScriptAttrs & NoRun & {
    speculation: {
        prefetch?: ScriptJson[];
        prerender?: ScriptJson[];
    } & {
        [key: string]: ScriptJson | undefined;
    };
    json?: never;
    ld?: never;
    importmap?: never;
};
export type ScriptOptions<A extends unknown[] = unknown[]> = ClassicScript<A> | ModuleScript<A> | ModuleImportsScript<Record<string, string>, A> | JsonScript | LdScript | ImportMapScript | SpeculationScript;
/**
 * An inline `<script>` tag. Pass a function and its args (shortcut for `{ run: fn, args }`) or one
 * options object; see
 * the module doc. Throws on an object with no payload or more than one, and on an attribute name
 * that is not one.
 */
export declare function script<A extends unknown[]>(run: (...args: A) => unknown, ...args: ScriptArgs<A>): string;
export declare function script<A extends unknown[]>(options: ClassicScript<A> | ModuleScript<A>): string;
export declare function script<I extends Record<string, string>, A extends unknown[] = []>(options: ModuleImportsScript<I, A>): string;
export declare function script(options: JsonScript | LdScript | ImportMapScript | SpeculationScript): string;
export {};
