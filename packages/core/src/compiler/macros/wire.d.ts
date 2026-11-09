import { type AstNode } from '../parse/oxc.ts';
/** The key expression a wire member rewrites to — the same symbol the runtime registry uses. */
export declare const WIRE_EXPR = "Symbol.for('ogygia.wire')";
type Node = AstNode;
/** If `node` is the member expression `import.meta.og.<name>`, return `<name>`; else null. */
export declare function og_member(node: Node | undefined): string | null;
/**
 * Rewrite every wire mark in `src`, enforcing the strict position rules. Extension-aware:
 * whole-file for JS/TS, `<script>` blocks for `.svelte`. Returns the input unchanged (same
 * reference) when there is nothing to do. Throws (build-error voice, file:line) on any misuse.
 * `markup_exts` is the resolved construct-host set (the plugin passes `['.svelte']`).
 */
export declare function rewrite_wire(src: string, id: string, markup_exts: readonly string[]): string;
export {};
