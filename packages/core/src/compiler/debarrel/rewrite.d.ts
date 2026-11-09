/**
 * The importer rewrite: every `import { … } from 'barrel'` whose names the index can place is
 * replaced, in place, by one import per leaf — attributes preserved, local names unchanged, type
 * modifiers kept. Names the index cannot place stay on the barrel; a pure barrel whose names all
 * moved loses its import, an impure (forced) one keeps a bare `import 'barrel'` so its own code
 * still runs. Pure over a lookup function and a code string; sourcemap via magic-string.
 */
import MagicString from 'magic-string';
import type { ExportMap } from './barrel.ts';
import { type ImportDecl } from './parse.ts';
export interface RewriteMove {
    barrel: string;
    names: string[];
    leaves: string[];
}
export interface RewriteResult {
    code: string;
    map: ReturnType<MagicString['generateMap']>;
    moves: RewriteMove[];
}
export interface Lookup {
    /** The barrel's export map for the import's specifier, or null when the import is left alone. */
    (source: string): Promise<ExportMap | null>;
}
export interface RewritePolicy {
    /** Leave this declaration exactly as written (ogygia: an import that carries region marks). */
    skip?: (decl: ImportDecl) => boolean;
}
/** Rewrite one module's import declarations. `offset` maps positions when `code` is a slice of a
 *  bigger file (a Svelte `<script>` block): edits are applied to `ms` at `offset + pos`. `id`
 *  names the code for the parser (its extension picks the dialect). */
export declare function rewrite_imports(code: string, id: string, lookup: Lookup, ms: MagicString, offset?: number, policy?: RewritePolicy): Promise<RewriteMove[]>;
/** Whole-file rewrite for a JS/TS module. */
export declare function rewrite_module(code: string, id: string, lookup: Lookup, policy?: RewritePolicy): Promise<RewriteResult | null>;
