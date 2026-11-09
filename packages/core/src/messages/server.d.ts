/**
 * EVERY MESSAGE OGYGIA'S SERVER PRINTS — the handle, the islands endpoint, region capabilities, the
 * page a render outside Kit reads: their code, their wording, what to do about them. Same calls as
 * the runtime's (./core.ts): the wording and the code's page in dev and while prerendering; a
 * production server prints the page's link alone.
 *
 *   throw new OgygiaError('handle_secret_too_short', { min });
 *   warn('endpoint_bad_signature', { id });
 */
import { type MessagesOf } from './define.ts';
/** The errors: `throw new OgygiaError(code, args)`, or `console.error(new OgygiaError(…))`. */
export declare const SERVER_ERRORS: {
    handle_secret_too_short: {
        text: (a: {
            min: number;
        }) => string;
        details: () => string;
    };
    secret_conflict: {
        text: (a: {
            key: string;
            decided: string;
            from: string;
        }) => string;
        details: () => string;
    };
    secret_missing_at_runtime: {
        text: () => string;
        details: () => string;
    };
    hole_props_too_large: {
        text: (a: {
            entry: string;
            length: number;
            max: number;
        }) => string;
        details: () => string;
    };
    prop_not_serializable: {
        text: (a: {
            entry: string;
            detail: string;
        }) => string;
        details: () => string;
    };
};
/** The warnings: `warn(code, args, ...rest)`. */
export declare const SERVER_WARNINGS: {
    region_render_failed: {
        text: () => string;
        details: () => string;
    };
    region_render_abandoned: {
        text: (a: {
            ms: number;
        }) => string;
        details: () => string;
    };
    endpoint_props_decode_failed: {
        text: () => string;
        details: () => string;
    };
    endpoint_foreign_key: {
        text: (a: {
            id: string;
            key: string;
            own: string;
        }) => string;
        details: () => string;
    };
    endpoint_bad_signature: {
        text: (a: {
            id: string;
        }) => string;
        details: () => string;
    };
    endpoint_unknown_id: {
        text: (a: {
            id: string;
            component?: string;
            known: number;
        }) => string;
        details: () => string;
    };
    live_props_not_serializable: {
        text: (a: {
            entry: string;
            max: number;
        }) => string;
        details: () => string;
    };
    build_key_prerender: {
        text: () => string;
        details: () => string;
    };
    secret_missing: {
        text: () => string;
        details: () => string;
    };
    outside_page_data_unavailable: {
        text: (a: {
            path: string;
            miss: string;
        }) => string;
        details: () => string;
    };
    outside_page_data_key: {
        text: (a: {
            path: string;
            key: string;
        }) => string;
        details: () => string;
    };
    router_css_inactive: {
        text: () => string;
        details: () => string;
    };
    plugin_hook_failed: {
        text: (a: {
            name: string;
        }) => string;
        details: () => string;
    };
    personal_response_unmarked: {
        text: (a: {
            status: number;
        }) => string;
        details: () => string;
    };
    request_cleanup_failed: {
        text: () => string;
        details: () => string;
    };
    rule_request_scope_open: {
        text: (a: {
            detail: string;
        }) => string;
        details: () => string;
    };
    rule_flight_kept_failure: {
        text: (a: {
            detail: string;
        }) => string;
        details: () => string;
    };
};
type Server = MessagesOf<typeof SERVER_ERRORS, typeof SERVER_WARNINGS>;
export declare const OgygiaError: Server['OgygiaError'];
export declare const warn: Server['warn'];
export declare const line: Server['line'];
export {};
