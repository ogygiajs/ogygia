/**
 * THE RESTORER — the browser half of reversible transforms (server/reversible.ts). An app's server
 * transform rendered each planned custom element (`og-h`) in scoped form: its rendered tree in the
 * host's light DOM, Svelte's children moved into `<slot>` wrappers inside it. This puts it back into
 * the form hydration and the component's runtime both expect:
 *
 *   1. stand-ins (`<og-as tag="a">`: tags the HTML parser would have restructured) become their real
 *      element, in place — a DOM operation, which no content-model rule applies to;
 *   2. for each planned host, innermost first: an open shadow root with the host's keyed sheets, the
 *      rendered tree moved into it (its `<slot>` wrappers become real slots), Svelte's children back
 *      in the light DOM in their original order and exactly as Svelte rendered them (attributes reset,
 *      trimmed or dropped text put back), the host's attributes back to Svelte's (except `og-keep`).
 *
 * The page stays painted the same throughout: the scoped form and the shadow form render alike, and
 * each host is restored in one task. It must run before anything reads the markup — before an island
 * snapshots or hydrates, before Kit starts, before a web-component runtime upgrades a host. So the
 * handle inlines it at the end of the document's body (`restore.toString()`: this function is
 * self-contained, no imports, no outer names), and the runtime calls it on a hole / lake answer before
 * insertion and on an incoming page before a router swap.
 *
 * A host that already has a shadow root when it is reached was upgraded first — the restore came
 * too late. The root is the component's own and is left to it; the light DOM still goes back to
 * Svelte's form, and the server's rendered copy is dropped (slotted beside the component's own
 * render it would show twice). It is reported (`ogygia:restore-late` on the host, the log, and
 * `restore_late` in every build). Answers are parsed inert (./parse-html.ts, #382), so this is the
 * page-load case: a component runtime that upgraded first.
 */
export declare function restore(root: Document | DocumentFragment | Element): number;
/** Adopt the sheets of roots restored outside the page, now that their hosts are in it (after a hole
 *  answer's insertion or a router swap, in the same task: no paint in between). Each root is one of
 *  three: IN THE PAGE (adopted now); in a fragment not inserted yet (another hole's answer still
 *  waiting for its stylesheet: kept for the call after its insertion); or in ANOTHER DOCUMENT — the
 *  incoming page's parsed copy, where the swap left what it did not take (a morph kept the live
 *  host): dropped. That last one counts as connected (its document is its root), and adopting a page
 *  sheet into it throws — which stopped every root after it from getting its sheets. A fragment root
 *  still out after 30 s never goes in (a morph took a copy of it, the hole left): dropped. */
export declare function restore_adopt(): void;
