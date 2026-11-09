import type { Scope } from '@ogygia/machine';
/** Marks ogygia's own lookup: the handle answers it without setting up a page render. */
export declare const PAGE_FACTS_HEADER = "x-ogygia-page-facts";
/** The route id and params Kit matched for the looked-up page (the data alone carries neither). */
export declare const PAGE_FACTS_ROUTE_HEADER = "x-ogygia-page-route";
export type PageFacts = {
    url: URL;
    params: Record<string, string | undefined>;
    route: {
        id: string | null;
    };
    data: Record<string, unknown>;
};
type Decoders = Record<string, (value: unknown) => unknown>;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
/** Kit's data URL for a page, as its client builds it: the data suffix on the path, the page's
 *  search kept, the trailing-slash marker when the path ends in `/`. */
export declare function data_url_of(page: URL): string;
/**
 * The page's facts, or a reason they are not available (a redirect, an error, a load that threw,
 * not a Kit data answer). `decoders`: the app's `transport` decoders, as Kit's client uses them.
 * `owner`: the request the look-up is for. When it ends, the answer's reader stops (a streamed
 * promise still pending then stays pending).
 */
export declare function look_up_page(page: URL, fetch: Fetch, decoders: Decoders, owner?: Scope): Promise<PageFacts | {
    miss: string;
}>;
export {};
