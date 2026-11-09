import { blank_styles } from '../blank-styles.ts';
import { type Lookup, type RewritePolicy, type RewriteResult } from './rewrite.ts';
export { blank_styles };
/** Why a component was skipped: the parser's code and where (1-based line and column). */
export interface SvelteSkip {
    code: string;
    line?: number;
    column?: number;
}
/** Rewrite the imports in a Svelte component's script blocks. Null when nothing changed.
 *  `on_skip`: told when the component still cannot be parsed (its imports then stay on their
 *  barrels) — the plugin warns and counts it, rather than skip in silence. */
export declare function rewrite_svelte(code: string, filename: string, lookup: Lookup, policy?: RewritePolicy, on_skip?: (why: SvelteSkip) => void): Promise<RewriteResult | null>;
