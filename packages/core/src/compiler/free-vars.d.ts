import type { SvelteNode } from './region/ir.ts';
/** Collect all snippet names defined anywhere in a subtree (for cross-boundary error detection). */
export declare function collectSnippetNames(nodes: SvelteNode[]): Set<unknown>;
/**
 * @param nodes hoisted subtree top-level nodes
 * @returns free identifier names + free mutation targets + `$store` read sites
 */
export declare function collectCaptureInfo(nodes: SvelteNode[]): {
    free: Set<string>;
    mutated: Set<string>;
    stores: Map<string, {
        start: number;
        end: number;
    }[]>;
};
/**
 * @param nodes hoisted subtree top-level nodes
 * @returns free identifier names
 */
export declare function collectFreeIdentifiers(nodes: SvelteNode[]): Set<string>;
