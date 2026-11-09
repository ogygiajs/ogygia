export interface ImportSpec {
    /** `default` | `namespace` | `named` */
    kind: 'default' | 'namespace' | 'named';
    /** the exported name asked for (`x` in `{ x as y }`, `default` for a default import) */
    imported: string;
    /** the local binding */
    local: string;
    /** `import { type T }` */
    type_only: boolean;
}
export interface ImportDecl {
    start: number;
    end: number;
    source: string;
    /** the verbatim ` with { … }` clause (leading space included), '' when none */
    attributes: string;
    /** the attribute keys (`wake` in `with { wake: 'load' }`) — what a mark-aware caller inspects */
    attribute_keys: string[];
    /** `import type { … }` — the whole declaration is type-only */
    type_only: boolean;
    /** bare `import 'x'` */
    side_effect: boolean;
    specs: ImportSpec[];
}
/** What a barrel says about one of its exported names. */
export type ExportRecord = {
    kind: 'reexport';
    exported: string;
    imported: string;
    source: string;
    type_only: boolean;
} | {
    kind: 'star';
    source: string;
    type_only: boolean;
} | {
    kind: 'star_ns';
    exported: string;
    source: string;
} | {
    kind: 'own';
    exported: string;
};
export interface ModuleShape {
    imports: ImportDecl[];
    exports: ExportRecord[];
    /** A PURE barrel: nothing but imports, re-exports, type declarations and `export {}`. */
    pure: boolean;
    /** Own names (declared in this module) that are exported. */
    own: Set<string>;
}
/**
 * Every top-level import of the module, with ranges the rewriter overwrites. Declarations that
 * cannot be rewritten (bare side-effect imports, namespace imports) are returned too, flagged, so
 * a caller sees the whole picture. Null on a syntax error.
 */
export declare function analyze_imports(code: string, id: string): ImportDecl[] | null;
/**
 * The export shape of a module. `pure` is the barrel test: the module contributes NO code of its
 * own — every statement is an import, a re-export, an `export {}` of imported bindings, a type
 * declaration, or an empty export. A module with any own declaration, expression statement, or
 * `export default <expr>` is IMPURE (it runs something), and is only rewritten when forced.
 * Null on a syntax error (or a file oxc cannot read as a module).
 */
export declare function analyze_exports(code: string, id: string): ModuleShape | null;
