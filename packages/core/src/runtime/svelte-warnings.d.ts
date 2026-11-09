/**
 * SVELTE'S HYDRATION WARNINGS, KEPT — in dev, Svelte says in the console when the server and the
 * browser disagreed while an island hydrated (`hydration_html_changed`, `hydration_attribute_changed`,
 * `hydration_mismatch`…). Svelte keeps the server's value, so nothing on screen shows it: the console
 * line is the only trace. This keeps each one (with the island hydrating at the time) for the devtools
 * and the profiler's browser half. Dev only (production Svelte has no such warnings); the console line
 * itself goes out unchanged. No regex: warnings are rare, read by string search.
 */
import type { Scope } from '@ogygia/machine';
export interface SvelteWarning {
    code: string;
    message: string;
    file?: string;
    fp?: string;
    t: number;
}
/** core.ts marks the island whose hydrate step is running. Svelte raises some warnings as the
 *  step's effects flush (a microtask after it returns): the mark holds until the task ends, and
 *  islands hydrate one per task, so the next one never inherits it. The task's end is `owner`'s to
 *  wait for (the island's lifetime in the page): an island gone first takes its mark with it. */
export declare function set_hydrating(el: Element, owner: Scope): void;
export declare function svelte_warnings(): SvelteWarning[];
export declare function on_svelte_warning(cb: (w: SvelteWarning) => void): void;
/** `%c[svelte] code\n%cmessage …` → the parts (null: not a Svelte hydration warning). */
export declare function parse_svelte_warning(text: string): {
    code: string;
    message: string;
    file?: string;
} | null;
export declare function tap_svelte_warnings(): void;
