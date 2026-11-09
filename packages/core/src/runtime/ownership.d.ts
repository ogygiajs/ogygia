/**
 * # DOM ownership — who owns a node inside a region (internal/notes/dom-ownership.md)
 *
 * Every ogygia DOM writer (the pre-hydration drift check and repair, the morph behind hole answers /
 * live ticks / navigations, drift-watch) asks THIS module whether it may touch an element, instead of
 * re-deriving the answer from its own subset of signals. One answer per element, one precedence:
 *
 * | owner     | what                                                                  |
 * |-----------|-----------------------------------------------------------------------|
 * | `foreign` | a subtree the app declared the live DOM's own (`data-ogygia-keep` / `data-persist` on a plain element) |
 * | `region`  | a hydrated region root: Svelte's reactivity owns it now, not a morph  |
 * | `page`    | `<ogygia-slot>`: host-page content an island adopts whole             |
 * | `static`  | an element the compiler stamped `data-og-opaque` — render output Svelte's hydration never walks into (`{@html}`, `bind:innerHTML`, a custom element with static children) — or a child element of one stamped `data-og-html` (it may be `{@html}` content) |
 * | `walk`    | everything else: render output Svelte's walk binds by position        |
 *
 * (Lakes are the sixth owner; the hydrate core lifts them out of both trees before any comparison,
 * so no writer here meets one.) What each writer does with each owner is the contract table in the
 * note; the short form:
 *  - the DRIFT CHECK and the REPAIR keep only `walk` in the server's shape — every other owner is one
 *    sibling to Svelte's walk (tag + position), never entered;
 *  - the MORPH never enters `foreign` or `region` (nor a morph ROOT that is `foreign`), and patches
 *    `static` / `page` / `walk` toward the answer;
 *  - DRIFT-WATCH ignores a change made inside a non-`walk` subtree (a widget upgrading its own light
 *    DOM is not the island drifting).
 *
 * `data-ogygia-keep` on an `<ogygia-region>` is NOT `foreign`: there it names an island that survives
 * navigation (a kept island) — Svelte owns that island, and it is repaired and hydrated like any other.
 *
 * FACETS (note §11): `owner_of` answers who writes INSIDE an element; the same module answers who
 * writes its ATTRIBUTES (`attributes_writer`, `REGION_RENDER_ATTRS`), who ORDERS its children
 * (`order_owner`), and whether a child EXISTS by the render's doing (`render_made`): one element, four
 * facets, one place. The morph's matching, attribute sync and removal all read them.
 */
/** The owner of an element, for the writers that consult it. */
export type Owner = 'foreign' | 'region' | 'page' | 'static' | 'walk';
/** The compiler's server-only stamp: Svelte's hydration never walks inside this element. */
export declare const OPAQUE_ATTR = "data-og-opaque";
/** The compiler's server-only stamp on an element holding an `{@html}` BESIDE other children: its
 *  child elements may be `{@html}` content, which Svelte never walks into. (PROD output opens an
 *  `{@html}` block with the same `<!---->` as any separator, so the exact range is not knowable from
 *  the DOM; its child elements are compared by tag and position only, never entered.) */
export declare const HTML_PARENT_ATTR = "data-og-html";
/** The app declared this subtree the live DOM's own: a plain element carrying `data-ogygia-keep` or
 *  `data-persist` (on a region, keep names a navigation-surviving island instead — not foreign). */
export declare function is_declared_foreign(el: Element): boolean;
/** A region whose subtree Svelte's reactivity owns (hydrated), or a kept island (it survives a
 *  navigation untouched) — matched by a morph, never entered. `data-hydrated` is only ever set on
 *  hyphenated roots, so its probe sits behind a cheap hyphen test. */
export declare function is_region_owned(el: Element): boolean;
/**
 * Who owns `el`. First match wins: `foreign` (declared) → `region` → `page` → `static` → `walk`.
 * `foreign` outranks `region` for plain elements only (a region never answers `foreign`), so a kept
 * island is `region` and a kept widget is `foreign`.
 */
export declare function owner_of(el: Element): Owner;
/** True when Svelte's hydration walk binds `el`'s CHILDREN by position — the only subtrees the drift
 *  check and the repair keep in the server's shape. */
export declare function walk_enters(el: Element): boolean;
/**
 * An UPGRADED CUSTOM ELEMENT: a live web component whose own runtime owns its host. Detected
 * STRUCTURALLY — a hyphenated name with a shadow root or a registered definition — never by a
 * library-specific attribute. The ONE detection every writer uses (the morph's attribute skip and
 * self-owned children, the repair's conflict report).
 */
export declare function is_upgraded_ce(el: Element): boolean;
/**
 * An element whose CHILDREN are partly its own doing, not the render's: an upgraded custom element
 * (it slots / rewrites its light DOM), or a `<dialog>` / `<details>` whose `open` the browser flips.
 * A child it gave itself is `foreign` content inside a `walk`-owned element: the live morph keeps it;
 * the repair removes it only where Svelte's walk needs the position (and reports the conflict).
 */
export declare function is_self_owned(el: Element): boolean;
/** Who writes an element's attributes: its own runtime (an upgraded custom element's host), Svelte's
 *  reactivity (a hydrated region root — but see {@link REGION_RENDER_ATTRS}), or the render. */
export declare function attributes_writer(el: Element): 'render' | 'element' | 'region';
/** The attributes of a region root that stay the render's: its ADDRESS, which the render that minted
 *  it writes (a re-minted hole fetches its new answer there); its content is its answer's. */
export declare const REGION_RENDER_ATTRS: readonly string[];
/** Who orders an element's children: the render (positions are its sequence), or the element itself
 *  (a self-owned element relocates and wraps its light DOM — positions are not the render's). */
export declare function order_owner(el: Element): 'render' | 'element';
/**
 * Does a self-owned element SLOT its light DOM — show it through a shadow root's `<slot>`s, in
 * document order — rather than render it itself? Then it has no reason to move a child: the children
 * are partly its own (it may add some), but the RENDER's nodes keep the render's order (morph.ts
 * `reconcile_by_identity`). One with no shadow root may relocate and wrap them: its arrangement stands.
 * (a closed shadow root is invisible here: such an element is taken to arrange, the safe side)
 */
export declare function slots_light_dom(el: Element): boolean;
/** A live region whose first HTML was baked into the page by Svelte's `{@html}` (Region.svelte,
 *  PromiseRegionAwait): kept for the element's life — Svelte's block anchors stay among its children. */
export declare const BAKED_ATTR = "data-og-baked";
/** Record that the render placed `node` (it may remove it once the render stops producing it). */
export declare function mark_render_made(node: Node): void;
/**
 * Does `node`, a child of an element-ordered parent, EXIST by the render's doing? Marked by ogygia, or
 * structurally: an `<ogygia-region>` is always render output, and an element whose tag the render
 * produces at this level (`render_tags`) is render output — a runtime does not make the render's
 * elements. Anything else is the element's own: never matched, never removed.
 */
export declare function render_made(node: Node, render_tags: ReadonlySet<string>): boolean;
/** Record what the server sent `root` (`<body>`): the attribute names on `sent` (the root as the
 *  server rendered it), and `children` (the live root's nodes that are the server's) as render output. */
export declare function record_server_body(root: Element, sent: Element, children: Iterable<Node>): void;
/** The attribute names the server last sent `root`, or null for a root with no record yet (all of
 *  it is then taken to be the server's). */
export declare function server_body_attributes(root: Element): ReadonlySet<string> | null;
/** Is `node`, a child of `<body>`, the server's? Recorded, or an `<ogygia-region>`. Anything else
 *  the page's scripts put there: a navigation neither matches nor removes it. */
export declare function server_body_child(node: Node): boolean;
