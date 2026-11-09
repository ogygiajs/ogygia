import { transport, encoders, decoders } from 'virtual:ogygia/transport';
import { query_responses, prerender_responses, query_map, live_query_map } from './remote-cache.ts';
export { query_responses, prerender_responses, query_map, live_query_map };
export declare const app: {
    hooks: {
        transport: typeof transport;
    };
    decoders: typeof decoders;
    encoders: typeof encoders;
};
export { goto, goto as _goto, invalidateAll, refreshAll } from '../app-navigation.ts';
export declare function set_nearest_error_page(): void;
/** Kit 3: a remote call's error, as the page shows it — an `error()`'s own body, else a 500. There
 *  are no client hooks to consult (the island world has no Kit client). */
export declare function handle_error(error: unknown): Promise<{
    status?: number;
    message: string;
}>;
/**
 * Seed `query_responses` from the `<script type="application/ogygia-remote">` the server emits on
 * csr=false pages (see `ogygiaHandle`). Mirrors Kit's own `start()` boot-seed, but sourced from a
 * side-channel because Kit only serializes remote data when csr===true. Parsed with the app's
 * transport decoders so custom types round-trip. Called ONCE by the runtime before the first
 * island hydrates, so every reused `Query` constructor finds its SSR value and never re-fetches.
 * @param text devalue-stringified `{ q?, l?, f? }` payload
 */
export declare function seed_query_responses(text: string): void;
