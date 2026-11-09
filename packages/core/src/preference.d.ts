/** A preference declaration: its name, allowed values, and default (which must be one of the values). */
export type PreferenceSpec = {
    name: string;
    values: readonly string[];
    default: string;
};
/** A live preference handle — SSR `head()`, client `get()`/`set()`, and the `attr` CSS authors target. */
export interface Preference {
    readonly name: string;
    readonly values: readonly string[];
    readonly default: string;
    /** The attribute set on `<html>`: `data-pref-<name>`. CSS targets `:root[<attr>="<value>"]`. */
    readonly attr: string;
    /** No-flash inline `<script>` string — reads localStorage and applies the attr before paint.
     *  `{@html}` it once in `<svelte:head>`. Idempotent, so emitting it more than once is harmless. */
    head(): string;
    /** CLIENT: persist + apply a new value (wire a control's handler to this). No-op on the server. */
    set(value: string): void;
    /** CLIENT: the current value (from the applied attr), or the default. Returns the default on the server. */
    get(): string;
}
/**
 * ONE delegated click handler that wires every preference switcher on the page: a click on any
 * `[data-pref][data-pref-set]` control (the buttons a variant switcher / package-manager tabs emit)
 * persists + applies that preference. Event delegation, so it survives SPA body-swaps and needs no
 * island. `{@html preference.switch()}` once in the layout, alongside each `preference(spec).head()`.
 * (`switch` is a property, not a binding — reserved words are fine there; mirrors `region.snippet`.)
 */
declare function preference_switch(): string;
/** Declare a site-wide client preference. Throws at creation if `default` isn't one of `values`. */
declare function preference_impl(spec: PreferenceSpec): Preference;
export declare const preference: typeof preference_impl & {
    switch: typeof preference_switch;
};
export {};
