/**
 * THE TOOLS' OWN REQUESTS — the devtools read the page's files too: a chunk's text to find the
 * runtime's parts, a stylesheet's rules, a HEAD to ask how a file is cached. The browser lists each
 * of those in its Resource Timing beside the page's own loads, and a reader of that list then counts
 * a file the page never loaded as loaded, takes a HEAD's empty body for a file's size, and sees the
 * page "fetch again" what it fetched once.
 *
 * So the tools ask through `tool_fetch`, which notes the address and the moment, and every reader of
 * the list (the byte ledger, an island's sizes, the beacon's files) leaves out what `tool_made` says
 * the tools caused. The notes live on a global: the runtime's beacon and the devtools are separate
 * bundles, and a page can carry two copies of either.
 *
 * Universal leaf: no imports.
 */
/** `fetch`, noted as the tools' own: the page's file lists leave its Resource Timing entry out. */
export declare function tool_fetch(url: string, init?: RequestInit): Promise<Response>;
/** Whether this Resource Timing entry is one of the tools' own requests (a `fetch` of a noted
 *  address that started when the tools asked), not the page's. */
export declare function tool_made(e: PerformanceResourceTiming): boolean;
