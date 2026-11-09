/**
 * EVERY MESSAGE OGYGIA'S RUNTIME PRINTS IN THE BROWSER, in one place: its code, whether it is thrown
 * or logged, its wording, and what to do about it (./define.ts says how the system works).
 *
 *   throw new OgygiaError('goto_not_http');
 *   warn('island_hydrate_failed', { entry }, err);
 *
 * Dev: the wording and the code's page. A production build: the page's link alone. The runtime's lazy
 * chunks take the same two from ./lazy.ts, island-side code (a shim a component imports) from
 * ./island.ts — neither imports this module (see there).
 */
import { type MessagesOf } from './define.ts';
/** Each message's arguments are its `text`'s: the one place they are written. */
/** The errors: `throw new OgygiaError(code, args)`, or `console.error(new OgygiaError(…), err)` for a
 *  failure that is caught. */
export declare const ERRORS: {
    goto_not_http: {
        text: () => string;
        details: () => string;
    };
    goto_cross_origin: {
        text: () => string;
        details: () => string;
    };
    island_load_failed: {
        text: (a: {
            entry: string | null;
        }) => string;
        details: () => string;
    };
    chunk_reload_needed: {
        text: (a: {
            url: string;
        }) => string;
        details: () => string;
    };
    runtime_load_failed: {
        text: () => string;
        details: () => string;
    };
    island_load_failed_stale_deps: {
        text: (a: {
            entry: string | null;
        }) => string;
        details: () => string;
    };
    island_hydrate_failed: {
        text: (a: {
            entry: string | null;
        }) => string;
        details: () => string;
    };
    interaction_hydrate_failed: {
        text: () => string;
        details: () => string;
    };
    restore_markup_broken: {
        text: (a: {
            diff: string;
        }) => string;
        details: () => string;
    };
    client_hooks_init_failed: {
        text: () => string;
        details: () => string;
    };
    wired_class_foreign: {
        text: () => string;
        details: () => string;
    };
    devalue_not_loaded: {
        text: () => string;
        details: () => string;
    };
    slot_not_linked: {
        text: (a: {
            name: string;
        }) => string;
        details: () => string;
    };
    boundary_refused: {
        text: (a: {
            site: string;
            path?: string;
            detail: string;
            more?: number;
        }) => string;
        details: () => string;
    };
    function_prop_cannot_cross: {
        text: (a: {
            where: string;
            reason: string;
        }) => string;
        details: () => string;
    };
    region_snippet_on_client: {
        text: () => string;
        details: () => string;
    };
    raw_region_on_client: {
        text: () => string;
        details: () => string;
    };
    held_region_plain_import: {
        text: () => string;
        details: () => string;
    };
    region_kind_mismatch: {
        text: () => string;
        details: () => string;
    };
    keep_fallback_inline: {
        text: () => string;
        details: () => string;
    };
    keep_fallback_signal: {
        text: () => string;
        details: () => string;
    };
    preference_default_invalid: {
        text: (a: {
            name: string;
            fallback: string;
            values: string;
        }) => string;
        details: () => string;
    };
    fn_factory_missing: {
        text: (a: {
            tag: string;
        }) => string;
        details: () => string;
    };
    fn_factory_not_function: {
        text: (a: {
            tag: string;
        }) => string;
        details: () => string;
    };
    fn_revive_missing: {
        text: (a: {
            tag: string;
        }) => string;
        details: () => string;
    };
    transportable_class_missing: {
        text: (a: {
            tag: string;
        }) => string;
        details: () => string;
    };
    transportable_unregistered: {
        text: (a: {
            name: string;
        }) => string;
        details: () => string;
    };
    ref_kind_missing: {
        text: (a: {
            kind: string;
        }) => string;
        details: () => string;
    };
    continuity_id_collision: {
        text: (a: {
            name: string;
            owner: string;
            tag: string;
        }) => string;
        details: () => string;
    };
    shared_state_not_plain: {
        text: (a: {
            name: string;
            reason: string;
        }) => string;
        details: () => string;
    };
    og_derived_formula_missing: {
        text: () => string;
        details: () => string;
    };
    script_run_not_function: {
        text: () => string;
        details: () => string;
    };
    script_imports_need_module: {
        text: () => string;
        details: () => string;
    };
    script_import_not_url: {
        text: (a: {
            name: string;
        }) => string;
        details: () => string;
    };
    script_run_rewritten: {
        text: () => string;
        details: () => string;
    };
    script_not_json: {
        text: (a: {
            key: string;
        }) => string;
        details: () => string;
    };
    script_one_kind: {
        text: (a: {
            count: number;
        }) => string;
        details: () => string;
    };
    script_bad_attribute: {
        text: (a: {
            key: string;
        }) => string;
        details: () => string;
    };
};
/** The warnings: `warn(code, args, ...rest)`. */
export declare const WARNINGS: {
    shallow_routing_unsupported: {
        text: (a: {
            method: string;
        }) => string;
        details: () => string;
    };
    scroll_handling_noop: {
        text: () => string;
        details: () => string;
    };
    hole_without_address: {
        text: (a: {
            region: string;
        }) => string;
        details: () => string;
    };
    nested_region_rides_parent: {
        text: (a: {
            entry: string;
            wake: string;
        }) => string;
        details: () => string;
    };
    region_endpoint_foreign: {
        text: (a: {
            endpoint: string;
        }) => string;
        details: () => string;
    };
    region_answer_denied: {
        text: (a: {
            endpoint: string;
            deny: string;
        }) => string;
        details: () => string;
    };
    region_answer_redirected: {
        text: (a: {
            endpoint: string;
            how: string;
            final_url: string;
        }) => string;
        details: () => string;
    };
    region_fetch_failed: {
        text: (a: {
            endpoint: string;
        }) => string;
        details: () => string;
    };
    island_healed: {
        text: (a: {
            entry: string;
            drift?: string | null;
        }) => string;
        details: () => string;
    };
    ownership_conflict: {
        text: (a: {
            element: string;
        }) => string;
        details: () => string;
    };
    hydration_discarded: {
        text: (a: {
            entry: string;
            drift?: string | null;
            strict?: string | null;
        }) => string;
        details: () => string;
    };
    prop_mutation: {
        text: (a: {
            prop: string;
            entry: string;
        }) => string;
        details: () => string;
    };
    island_on_kit_page: {
        text: (a: {
            entry: string;
        }) => string;
        details: () => string;
    };
    island_block_in_inline: {
        text: (a: {
            entry: string;
        }) => string;
        details: () => string;
    };
    keep_without_router: {
        text: (a: {
            entry: string;
            key: string;
        }) => string;
        details: () => string;
    };
    live_feature_missing: {
        text: () => string;
        details: () => string;
    };
    live_region_no_host: {
        text: (a: {
            id: string;
        }) => string;
        details: () => string;
    };
    live_region_no_endpoint: {
        text: (a: {
            id: string;
        }) => string;
        details: () => string;
    };
    region_newer_page_data: {
        text: (a: {
            keys: string;
        }) => string;
        details: () => string;
    };
    kit_page_waiting: {
        text: (a: {
            seconds: number;
            booted: boolean;
        }) => string;
        details: () => string;
    };
    foreign_page_read: {
        text: (a: {
            expr: string;
            entry: string;
            origin: string;
        }) => string;
        details: () => string;
    };
    context_marker_large: {
        text: (a: {
            size: string;
            top: string;
        }) => string;
        details: () => string;
    };
    context_dropped: {
        text: (a: {
            key: string;
        }) => string;
        details: () => string;
    };
    context_unserializable: {
        text: (a: {
            key: string;
            path?: string;
            detail: string;
        }) => string;
        details: () => string;
    };
    page_seed_ref_missing: {
        text: (a: {
            path: string;
        }) => string;
        details: () => string;
    };
    store_not_extensible: {
        text: (a: {
            tag: string;
        }) => string;
        details: () => string;
    };
    store_factory_missing: {
        text: (a: {
            tag: string;
        }) => string;
        details: () => string;
    };
    store_factory_bad_rebuild: {
        text: (a: {
            tag: string;
            got: string;
        }) => string;
        details: () => string;
    };
    store_factory_unbranded: {
        text: (a: {
            tag: string;
            got: string;
        }) => string;
        details: () => string;
    };
    region_promise_no_placeholder: {
        text: () => string;
        details: () => string;
    };
    nested_server_island_inline: {
        text: (a: {
            entry: string;
        }) => string;
        details: () => string;
    };
    nested_island_with_parent: {
        text: (a: {
            entry: string;
        }) => string;
        details: () => string;
    };
    lake_mounted_without_html: {
        text: (a: {
            entry: string;
        }) => string;
        details: () => string;
    };
    rule_region_mounted_twice: {
        text: (a: {
            detail: string;
        }) => string;
        details: () => string;
    };
    rule_address_bar_drift: {
        text: (a: {
            detail: string;
        }) => string;
        details: () => string;
    };
    rule_old_page_open: {
        text: (a: {
            detail: string;
        }) => string;
        details: () => string;
    };
    rule_failure_uncoded: {
        text: (a: {
            detail: string;
        }) => string;
        details: () => string;
    };
    rule_parse_upgraded: {
        text: (a: {
            detail: string;
        }) => string;
        details: () => string;
    };
    restore_late: {
        text: (a: {
            host: string;
        }) => string;
        details: () => string;
    };
};
type Core = MessagesOf<typeof ERRORS, typeof WARNINGS>;
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs. Wording and link in dev,
 *  the link alone in a production build. */
export declare const OgygiaError: Core['OgygiaError'];
export declare const warn: Core['warn'];
export declare const line: Core['line'];
export {};
