/**
 * EVERY MESSAGE OGYGIA PRINTS AT BUILD TIME — the compiler and the Vite plugin, which run in Node
 * (never in a page, so there is no production build to keep the wording out of): their code, their
 * wording, what to do about them. Same calls as the runtime's (./core.ts):
 *
 *   throw new OgygiaError('some_code', { file });
 *   warn('some_code', { file });
 *
 * The wording always prints, then the code's page `https://ogygiajs.dev/e/<code>?<args>`.
 */
import { type MessagesOf } from './define.ts';
/** Retired `ogygia({ … })` keys, each with its new spelling: the config check throws
 *  `option_retired` for any of them (a legacy key that silently did nothing would un-tune real
 *  apps). */
export declare const RETIRED_OPTIONS: Record<string, string>;
/** The errors: `throw new OgygiaError(code, args)`. */
export declare const BUILD_ERRORS: {
    macro_store_misuse: {
        text: (a: {
            file: string;
            line: number;
            problem: string;
        }) => string;
        details: () => string;
    };
    macro_dollar_misuse: {
        text: (a: {
            file: string;
            line: number;
            problem: string;
        }) => string;
        details: () => string;
    };
    macro_wire_misuse: {
        text: (a: {
            file: string;
            line: number;
            problem: string;
        }) => string;
        details: () => string;
    };
    macro_source_misuse: {
        text: (a: {
            file: string;
            line: number;
            problem: string;
        }) => string;
        details: () => string;
    };
    macro_bake_arity: {
        text: (a: {
            file: string;
            line: number;
        }) => string;
        details: () => string;
    };
    macro_bake_not_function: {
        text: (a: {
            file: string;
            line: number;
        }) => string;
        details: () => string;
    };
    macro_bake_eval_failed: {
        text: (a: {
            file: string;
            reason: string;
        }) => string;
        details: () => string;
    };
    macro_bake_not_serializable: {
        text: (a: {
            file: string;
            line: number;
            reason: string;
        }) => string;
        details: () => string;
    };
    kit_config_not_literal: {
        text: (a: {
            file: string;
            key: string;
        }) => string;
        details: () => string;
    };
    island_import_unresolved: {
        text: (a: {
            specifier: string;
            host: string;
        }) => string;
        details: () => string;
    };
    call_arg_not_literal: {
        text: (a: {
            call: string;
            got: string;
        }) => string;
        details: () => string;
    };
    call_arg_interpolated: {
        text: (a: {
            call: string;
        }) => string;
        details: () => string;
    };
    call_arg_in_expression: {
        text: (a: {
            call: string;
            near: string;
        }) => string;
        details: () => string;
    };
    import_key_invalid: {
        text: (a: {
            role: string;
            got: string;
        }) => string;
        details: () => string;
    };
    import_keys_not_distinct: {
        text: () => string;
        details: () => string;
    };
    region_value_not_raw: {
        text: (a: {
            host: string;
            key: string;
        }) => string;
        details: () => string;
    };
    wake_strategy_unknown: {
        text: (a: {
            host: string;
            key: string;
            value: string;
        }) => string;
        details: () => string;
    };
    generated_module_relative_import: {
        text: (a: {
            host: string;
            specifier: string;
        }) => string;
        details: () => string;
    };
    region_import_invalid: {
        text: (a: {
            host: string;
            names: string;
            problem: string;
        }) => string;
        details: () => string;
    };
    as_region_invalid: {
        text: (a: {
            host: string;
            name: string;
            problem: string;
        }) => string;
        details: () => string;
    };
    region_children_not_portable: {
        text: (a: {
            host: string;
            tag: string;
            server: boolean;
        }) => string;
        details: () => string;
    };
    region_dotted_tag: {
        text: (a: {
            host: string;
            tag: string;
            import: string;
        }) => string;
        details: () => string;
    };
    dynamic_region_import: {
        text: (a: {
            host: string;
            keys: string;
            wake_key: string;
            render_key: string;
            preset_key: string;
        }) => string;
        details: () => string;
    };
    region_import_no_specifier: {
        text: (a: {
            host: string;
            name: string;
            held: boolean;
        }) => string;
        details: () => string;
    };
    snippet_reads_dollar_props: {
        text: (a: {
            host: string;
            snippet: string;
            name: string;
        }) => string;
        details: () => string;
    };
    held_fetch_without_render: {
        text: (a: {
            host: string;
            fetch_key: string;
            render_key: string;
            wake_key: string;
            value: string;
        }) => string;
        details: () => string;
    };
    held_render_live: {
        text: (a: {
            host: string;
            render_key: string;
        }) => string;
        details: () => string;
    };
    held_render_unknown: {
        text: (a: {
            host: string;
            render_key: string;
            value: string;
        }) => string;
        details: () => string;
    };
    held_hole_timed_twice: {
        text: (a: {
            host: string;
            render_key: string;
            fetch_key: string;
            wake_key: string;
            fetch: string;
            wake: string;
        }) => string;
        details: () => string;
    };
    held_fetch_not_timing: {
        text: (a: {
            host: string;
            fetch_key: string;
            value: string;
        }) => string;
        details: () => string;
    };
    held_marker_mixed: {
        text: (a: {
            host: string;
            name: string;
            region_key: string;
            wake_key: string;
            render_key: string;
            fetch_key: string;
        }) => string;
        details: () => string;
    };
    option_retired: {
        text: (a: {
            option: string;
        }) => string;
        details: () => string;
    };
    preset_empty: {
        text: (a: {
            name: string;
        }) => string;
        details: () => string;
    };
    preset_key_unknown: {
        text: (a: {
            name: string;
            key: string;
            allowed: string;
        }) => string;
        details: () => string;
    };
    max_page_age_invalid: {
        text: (a: {
            value: string;
        }) => string;
        details: () => string;
    };
    secret_too_short: {
        text: (a: {
            min_bytes: number;
        }) => string;
        details: () => string;
    };
    kit_remote_src_missing: {
        text: () => string;
        details: () => string;
    };
    package_files_not_array: {
        text: (a: {
            package: string;
            got: string;
        }) => string;
        details: () => string;
    };
    package_files_escapes: {
        text: (a: {
            package: string;
            entry: string;
        }) => string;
        details: () => string;
    };
    plugin_without_ogygia: {
        text: (a: {
            plugin: string;
        }) => string;
        details: () => string;
    };
    plugin_factory_not_called: {
        text: () => string;
        details: () => string;
    };
    plugin_after_sveltekit: {
        text: (a: {
            plugin: string;
        }) => string;
        details: () => string;
    };
    plugin_name_missing: {
        text: () => string;
        details: () => string;
    };
    plugin_listed_twice: {
        text: (a: {
            plugin: string;
        }) => string;
        details: () => string;
    };
    plugin_realm_not_location: {
        text: (a: {
            plugin: string;
            realm: string;
        }) => string;
        details: () => string;
    };
    plugin_options_not_json: {
        text: (a: {
            plugin: string;
        }) => string;
        details: () => string;
    };
    plugin_realm_not_file: {
        text: (a: {
            plugin: string;
            realm: string;
            location: string;
        }) => string;
        details: () => string;
    };
    plugin_package_unresolved: {
        text: (a: {
            plugin: string;
            root: string;
        }) => string;
        details: () => string;
    };
    route_config_key_invalid: {
        text: (a: {
            plugin: string;
            key: string;
        }) => string;
        details: () => string;
    };
    route_config_key_claimed: {
        text: (a: {
            key: string;
            owner: string;
            plugin: string;
        }) => string;
        details: () => string;
    };
    plugin_macro_name_invalid: {
        text: (a: {
            plugin: string;
            name: string;
        }) => string;
        details: () => string;
    };
    plugin_macro_claimed: {
        text: (a: {
            name: string;
            owner: string;
            plugin: string;
        }) => string;
        details: () => string;
    };
    page_modules_not_absolute: {
        text: (a: {
            plugin: string;
            file: string;
        }) => string;
        details: () => string;
    };
    request_event_server_only: {
        text: () => string;
        details: () => string;
    };
};
/** The warnings: `warn(code, args, ...rest)`; and, at its end, the build's reports, which print
 *  their `line(code, args)` at info level. */
export declare const BUILD_WARNINGS: {
    macro_store_returns_non_store: {
        text: (a: {
            file: string;
            line: number;
        }) => string;
        details: () => string;
    };
    scoped_css_failed: {
        text: (a: {
            file: string;
            reason: string;
        }) => string;
        details: () => string;
    };
    package_marks_undeclared: {
        text: (a: {
            file: string;
        }) => string;
        details: () => string;
    };
    island_context_unprovided: {
        text: (a: {
            file: string;
            key: string;
        }) => string;
        details: () => string;
    };
    content_leaked_to_client: {
        text: (a: {
            count: number;
            chunk: string;
            modules: string;
        }) => string;
        details: () => string;
    };
    region_host_skipped: {
        text: (a: {
            file: string;
            reason: string;
            at: string;
        }) => string;
        details: () => string;
    };
    hole_wake_deprecated: {
        text: (a: {
            host: string;
            said?: string;
            render_key: string;
            wake_key: string;
            fetch_key: string;
            value: string;
        }) => string;
        details: () => string;
    };
    snippet_store_snapshot: {
        text: (a: {
            host: string;
            snippet: string;
            store: string;
            at: string;
        }) => string;
        details: () => string;
    };
    snippet_store_unverified: {
        text: (a: {
            host: string;
            snippet: string;
            store: string;
            at: string;
        }) => string;
        details: () => string;
    };
    snippet_captures_store: {
        text: (a: {
            host: string;
            snippet: string;
            store: string;
        }) => string;
        details: () => string;
    };
    barrels_component_skipped: {
        text: (a: {
            file: string;
            reason: string;
            at: string;
        }) => string;
        details: () => string;
    };
    sass_missing: {
        text: () => string;
        details: () => string;
    };
    scss_compile_failed: {
        text: (a: {
            file: string;
            reason: string;
        }) => string;
        details: () => string;
    };
    ts_strip_failed: {
        text: (a: {
            file: string;
            reason: string;
        }) => string;
        details: () => string;
    };
    optimize_deps_includes_ogygia: {
        text: (a: {
            specifiers: string;
            count: number;
        }) => string;
        details: () => string;
    };
    island_handoff_write_failed: {
        text: () => string;
        details: () => string;
    };
    package_files_missing: {
        text: (a: {
            package: string;
            entry: string;
        }) => string;
        details: () => string;
    };
    kit_config_unreadable: {
        text: (a: {
            file: string;
            routes: string;
            out: string;
            reason: string;
        }) => string;
        details: () => string;
    };
    island_chunks_not_emitted: {
        text: (a: {
            count: number;
        }) => string;
        details: () => string;
    };
    flags_manifest_written: {
        text: (a: {
            count: number;
        }) => string;
        details: () => string;
    };
    page_seed_report: {
        text: (a: {
            islands: number;
            pinned: number;
            keys: number;
            unpinned: number;
        }) => string;
        details: () => string;
    };
    barrels_report: {
        text: (a: {
            importers: string;
            files: string;
            imports: string;
            names: string;
            barrels: string;
            seconds: string;
        }) => string;
        details: () => string;
    };
    barrels_report_none: {
        text: (a: {
            files: string;
            seconds: string;
        }) => string;
        details: () => string;
    };
    barrels_rewrite: {
        text: (a: {
            file: string;
            names: string;
            barrel: string;
            leaves: string;
        }) => string;
        details: () => string;
    };
};
type Build = MessagesOf<typeof BUILD_ERRORS, typeof BUILD_WARNINGS>;
export declare const OgygiaError: Build['OgygiaError'];
export declare const warn: Build['warn'];
/** A code's line as a string, for a logger that takes one (Rollup's `this.warn`). */
export declare const line: Build['line'];
export {};
