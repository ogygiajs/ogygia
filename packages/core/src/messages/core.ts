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
import { define_messages, type MessagesOf } from './define.ts';
import { prose } from './prose.ts';

const BUG = 'An ogygia bug: please report it with the page that shows it.';

/** Each message's arguments are its `text`'s: the one place they are written. */
/** The errors: `throw new OgygiaError(code, args)`, or `console.error(new OgygiaError(…), err)` for a
 *  failure that is caught. */
export const ERRORS = {
	goto_not_http: {
		text: (): string => 'goto() only supports http(s) URLs',
		details: (): string => prose`
			\`goto()\` was called with a URL whose scheme is not \`http:\` or \`https:\` (a \`mailto:\`,
			a \`javascript:\`, a custom scheme). Navigate to it with a plain link or
			\`location.assign()\` instead.
		`
	},
	goto_cross_origin: {
		text: (): string => 'goto() only supports same-origin URLs (pass { external: true } to leave)',
		details: (): string => prose`
			\`goto()\` navigates inside the app, so a URL on another origin is refused. To leave the
			app, pass \`{ external: true }\`: \`goto(url, { external: true })\` does a full page load.
		`
	},
	island_load_failed: {
		text: (a: { entry: string | null }): string => `island entry failed to load: ${a.entry}`,
		details: (): string => prose`
			The island's module could not be fetched, so the island stays as its server HTML. This is
			a load error, not a hydration error: the file is missing or the network failed. After a
			deploy, ogygia retries the current build's file first.
		`
	},
	island_load_failed_stale_deps: {
		text: (a: { entry: string | null }): string => prose`
			island entry failed to load: ${a.entry}

			The module could not be FETCHED (not a hydration error). In dev this almost always means
			Vite re-optimized dependencies and rotated its optimizer hash while this tab was open, so
			its dep imports 404. Recovering… Original error:
		`,
		details: (): string => prose`
			Dev only. Vite re-optimized its dependencies while the tab was open, so the island's
			imports point at files that no longer exist. ogygia reloads the page to recover.
		`
	},
	island_hydrate_failed: {
		text: (a: { entry: string | null }): string => `hydration failed for ${a.entry}`,
		details: (): string => prose`
			The island's module loaded, but hydrating it threw. The error follows the message: it is
			usually the component itself throwing while it initializes.
		`
	},
	interaction_hydrate_failed: {
		text: (): string => 'interaction island failed to hydrate — leaving it static.',
		details: (): string => prose`
			An island waking on interaction threw while it hydrated, so it stays as its server HTML.
			The click that woke it is replayed on that HTML. The error follows the message.
		`
	},
	restore_markup_broken: {
		text: (a: { diff: string }): string => `the transform broke hydration markup: ${a.diff}`,
		details: (): string => prose`
			A transform rewrote a restored region's markup so that its hydration markers no longer
			match. \`diff\` names the first difference. (The restore runs as a self-contained script,
			so it prints this code's link itself.)
		`
	},
	client_hooks_init_failed: {
		text: (): string => 'hooks.client init failed:',
		details: (): string => "The app's `hooks.client` `init()` threw. The error follows the message."
	},
	wired_class_foreign: {
		text: (): string => prose`
			a wired class crossed a build boundary: foreign (stitched-fragment) island props must be
			plain data — wired live objects cannot reunite across two svelte runtimes. Pass the
			underlying data instead.
		`,
		details: (): string => prose`
			A stitched fragment's island received a wired object (a class registered with ogygia's
			wire) from another build. Two Svelte runtimes cannot share it. Pass plain data instead.
		`
	},
	devalue_not_loaded: {
		text: (): string =>
			'a devalue-lane payload was read before devalue loaded (load_devalue() first)',
		details: (): string => BUG
	},
	slot_not_linked: {
		text: (a: { name: string }): string =>
			`runtime chunk used \`slots.${a.name}\` before the boot linked it`,
		details: (): string => BUG
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const WARNINGS = {
	shallow_routing_unsupported: {
		text: (a: { method: string }): string =>
			`${a.method}() shallow routing is not supported; use goto().`,
		details: (): string => prose`
			Kit's \`pushState\` / \`replaceState\` (shallow routing) have no equivalent in the ogygia
			router: the call does nothing. Navigate with \`goto()\`, or keep the state in the URL.
		`
	},
	scroll_handling_noop: {
		text: (): string => 'disableScrollHandling() is a no-op in the islands SPA router.',
		details: (): string => prose`
			The ogygia router restores and resets scroll itself on every navigation;
			\`disableScrollHandling()\` does nothing there.
		`
	},
	hole_without_address: {
		text: (a: { region: string }): string => prose`
			deferred region ${a.region} was rendered in the browser with no server-minted address,
			and the document records none for it (a client-side navigation mounted it, or its props
			differ from the server render) — its fallback stands. A hole is server HTML: render it on
			the server.
		`,
		details: (): string => prose`
			A deferred region (a hole) is fetched from an address the server signs while it renders
			the page. This one was created in the browser, so it has no address and keeps its
			fallback.

			Render the hole on the server: keep it out of browser-only branches, and give it the same
			props on both sides.
		`
	},
	nested_region_rides_parent: {
		text: (a: { entry: string; wake: string }): string => prose`
			nested region "${a.entry}" skipped self-run; the nearest region above it is awake, so it
			rides that hydration (inner hydrate "${a.wake}" ignored).
		`,
		details: (): string => prose`
			A region inside an awake region hydrates with it, once, as part of the outer island. Its
			own \`wake\` schedule is ignored. To give it its own schedule, put a lake
			(\`wake: 'none'\`) between the two.
		`
	},
	region_endpoint_foreign: {
		text: (a: { endpoint: string }): string =>
			`refused non-same-origin region endpoint ${a.endpoint}`,
		details: (): string => prose`
			A region's \`endpoint\` pointed at another origin. The runtime only fetches region answers
			from the page's own origin; the fallback stands.
		`
	},
	region_answer_denied: {
		text: (a: { endpoint: string; deny: string }): string => prose`
			region answer refused for ${a.endpoint}:
			${a.deny.startsWith('not ogygia') ? a.deny : `the islands endpoint refused its capability (403: ${a.deny})`}.
			${
				a.deny.startsWith('foreign-key') &&
				prose`
					The page and its islands endpoint came from different deployments (two keys): route
					the endpoint to the deployment that served the page, or give every deployment one
					OGYGIA_SECRET.
				`
			}
			The fallback stands.
		`,
		details: (): string => prose`
			The islands endpoint refused the signed address of a region (a 403), so its fallback
			stands. The reason is in \`deny\`.

			\`foreign-key\`: the page and its islands endpoint came from different deployments, each
			signing with its own key. Route the endpoint to the deployment that served the page, or
			give every deployment the same \`OGYGIA_SECRET\`.

			\`not ogygia\`: the answer did not come from ogygia at all; something in front of
			\`ogygia.handle()\` answered it.
		`
	},
	region_answer_redirected: {
		text: (a: { endpoint: string; how: string; final_url: string }): string => prose`
			region answer refused for ${a.endpoint}: the request was
			${a.how === 'redirected' ? 'redirected to' : 'answered with a whole document at'} ${a.final_url}.
			A handle in front of ogygia.handle() (an auth redirect, a locale bounce, a 404 handler)
			took the region request — exempt the islands endpoint there. The fallback stands.
		`,
		details: (): string => prose`
			A handle that runs before \`ogygia.handle()\` answered the region request itself: an auth
			redirect, a locale bounce, a 404 page. The runtime refuses such an answer and keeps the
			fallback.

			Exempt the islands endpoint (\`/__ogygia__\`) in that handle.
		`
	},
	region_fetch_failed: {
		text: (a: { endpoint: string }): string => `region fetch failed for ${a.endpoint}`,
		details: (): string => prose`
			The request for a region's HTML failed (the network, a server error). The runtime retries
			a few times; the fallback stands until one succeeds. The error follows the message.
		`
	},
	island_healed: {
		text: (a: { entry: string; drift?: string | null }): string => prose`
			island "${a.entry}" was edited while it slept (its light DOM no longer matched the server
			render — a design-system runtime, an A/B tool, a translator), so its server HTML was put
			back and hydrated instead of re-rendering it client-side. Whatever the edit added is gone;
			the script that made it should leave <ogygia-region> subtrees alone.

			${a.drift && `What drifted: ${a.drift}`}
		`,
		details: (): string => prose`
			Dev only. Something edited the island's HTML before it woke (a design-system runtime, an
			A/B tool, a translator). ogygia put the server HTML back and hydrated that, instead of
			letting Svelte throw it away and re-render. Whatever the edit added is gone.

			Make the script that edits the page leave \`<ogygia-region>\` subtrees alone.
		`
	},
	ownership_conflict: {
		text: (a: { element: string }): string => prose`
			${a.element} is a web component that changed its own children in a position Svelte's
			hydration reads, so the repair had to remove the nodes it added. Render that subtree with
			{@html} or as static markup (Svelte never reads inside it), put it in a lake
			(wake: 'none'), or mark the element data-ogygia-keep.
		`,
		details: (): string => prose`
			Dev only. A web component inside the island added children where Svelte's hydration
			expects the server's nodes. To hydrate the island, the repair removed them.

			Render that subtree with \`{@html}\` or as static markup (Svelte never reads inside it),
			put it in a lake (\`wake: 'none'\`), or mark the element \`data-ogygia-keep\`.
		`
	},
	hydration_discarded: {
		text: (a: { entry: string; drift?: string | null; strict?: string | null }): string => prose`
			island "${a.entry}" discarded its ENTIRE server-rendered DOM during hydration and
			re-rendered client-side (Svelte hydration-mismatch recovery). Three things cause this.
			(1) Something changed this region's HTML between SSR and wake — a post-SSR transform
			(transformPageChunk / an HTML-rewriting middleware), an A/B-testing snippet, or an edge
			rewriter; whatever it injected (e.g. declarative shadow DOM) was just destroyed, and the
			swap is timing-dependent, so symptoms look erratic. (2) A component in this island reads
			a page/layout CONTEXT via plain Svelte setContext — on csr=false that runs only on the
			server, so getContext returns undefined on the client and the island renders a different
			tree. (3) A block in this island ({#if} / {:else if} / {#each} / {#await}) took a
			DIFFERENT branch on the client than on the server — its condition reads something that
			differs between the two (a browser global, a store's client default, url/page state, a
			Date). Svelte recovers a branch mismatch SILENTLY (no throw); the walk is then off and
			the rest of the tree follows.

			${a.drift && `What changed: ${a.drift}`}

			${
				// The walk's own verdict, after any repair — the one line that separates "repair left a
				// residue" (1) from "the sequence was fine and Svelte failed for a reason this walk
				// can't see" (2/3). No drift AND no throw is the signature of (3).
				a.strict
					? `Svelte threw on the strict attempt (after repair): ${a.strict}`
					: a.drift
						? 'Svelte did not throw after the repair — the mismatch is one this walk does not model.'
						: prose`
							The server node sequence was INTACT and Svelte did not throw: nothing mutated
							this region's DOM, so this is (3) (or (2)). Find the block whose branch
							differs: in the server markup its anchor reads <!--[N--> where N is the
							branch the SERVER chose.
						`
			}

			Fix: for (1) make the mutation invisible to hydration (mutate only <head>, attributes, or
			shadow templates — never the region's light DOM), or freeze the foreign-owned subtree
			with a wake:'none' (lake) boundary; for (2) provide the value with setContext / <Provide>
			/ createContext imported from 'ogygia', read it with the same getContext(key); for (3)
			make the condition read the same value on both sides (a prop / page.data), or move the
			browser-only branch behind an $effect / hydratedBy().
		`,
		details: (): string => prose`
			Svelte could not adopt the island's server HTML, so it threw it away and rendered the
			island again in the browser: a flash, and anything injected into that HTML is gone. Three
			things cause it.

			1. Something changed the region's HTML between the server render and the wake: a
			post-SSR transform (\`transformPageChunk\`, an HTML-rewriting middleware), an A/B-testing
			snippet, an edge rewriter. \`drift\` names the first difference. Mutate only the head,
			attributes or shadow templates, never the region's light DOM, or freeze that subtree in a
			lake (\`wake: 'none'\`).

			2. A component reads a page or layout context set with plain \`setContext\`. On a
			csr=false page that runs only on the server, so the browser renders a different tree.
			Provide the value with \`setContext\` / \`<Provide>\` / \`createContext\` imported from
			\`ogygia\`.

			3. A block (\`if\`, \`each\`, \`await\`) took a different branch in the browser than on
			the server: its condition reads a browser global, a store's client default, URL state or a
			date. With no \`drift\` and no \`strict\` error this is the cause. Make the condition read
			the same value on both sides (a prop, \`page.data\`), or move the browser-only branch
			behind an \`$effect\` or \`hydratedBy()\`.
		`
	},
	prop_mutation: {
		text: (a: { prop: string; entry: string }): string => prose`
			mutating prop '${a.prop}' inside island ${a.entry} — island props are a serialized
			snapshot of the host, or a reference into page.data shared with every island that reads
			it: the write updates nothing (or leaks into page.data). Move mutable state inside the
			island component.
		`,
		details: (): string => prose`
			Dev only. An island's props are a snapshot the server serialized, or a reference into
			\`page.data\` that every island shares. Writing to them updates nothing on the page (or
			leaks into \`page.data\`). Copy the value into the island's own \`$state\` and change that.
		`
	},
	island_on_kit_page: {
		text: (a: { entry: string }): string => prose`
			island "${a.entry}" is on a csr=true page; Kit hydrates it, so the island directive is
			redundant here (it behaves as a normal component).
		`,
		details: (): string => prose`
			Dev only. On a csr=true page Kit hydrates the whole page, so an island there is an
			ordinary component. Its \`wake\` does nothing on this page.
		`
	},
	island_block_in_inline: {
		text: (a: { entry: string }): string => prose`
			island "${a.entry}" rendered a BLOCK element inline inside a <p> (or other phrasing-only
			context). The browser's HTML parser hoisted that block out of the paragraph before
			hydration, so this region is empty and a SECOND copy is about to mount here — the
			server-rendered copy is now an orphaned sibling of the paragraph. Fix: make the component
			render an inline element (e.g. <span> instead of <div>), or place the island on its own
			line (block context) rather than inside a sentence.
		`,
		details: (): string => prose`
			Dev only. The island renders a block element (a \`div\`, a \`p\`) inside a paragraph. The
			browser's parser moves that block out of the paragraph before any script runs, so the
			region is empty and a second copy mounts beside the first.

			Render an inline element (a \`span\`), or place the island on its own line.
		`
	},
	keep_without_router: {
		text: (a: { entry: string; key: string }): string => prose`
			island "${a.entry}" has keep:'${a.key}' but the SPA router is off
			(ogygia({ router: false })) — keep relies on SPA navigation; a full-page load replaces
			the DOM, so the attribute is a no-op here.
		`,
		details: (): string => prose`
			Dev only. \`keep\` keeps an island across client navigations, so it needs the ogygia
			router. With \`ogygia({ router: false })\` every navigation is a full page load and nothing
			is kept.
		`
	},
	live_feature_missing: {
		text: (): string => 'live region needs the live feature plugin (LiveHost missing)',
		details: (): string => prose`
			Dev only. A live region woke, but the build has no live feature to hydrate it with. ${BUG}
		`
	},
	live_region_no_host: {
		text: (a: { id: string }): string => prose`
			render:'live' region "${a.id}" has no island host — on regular pages it will never
			revalidate (only on documents served from a page store). Wrap it in a wake:'load' island
			to drive remount revalidation.
		`,
		details: (): string => prose`
			A \`render: 'live'\` lake revalidates when the island around it remounts. This one has no
			island around it, so it never refreshes on a regular page. Wrap it in a
			\`wake: 'load'\` island.
		`
	},
	live_region_no_endpoint: {
		text: (a: { id: string }): string => prose`
			region "${a.id}" is render:'live' but no signed endpoint was captured at SSR — painting
			the cache only.
		`,
		details: (): string => prose`
			Dev only. The live region has no signed address from the server render, so it shows its
			cached HTML and never refreshes.
		`
	},
	region_newer_page_data: {
		text: (a: { keys: string }): string => prose`
			a region came back rendered with newer page.data (${a.keys}) than this Kit page holds.
			Refresh the page's data (invalidateAll()) before refreshing the region, or the islands
			inside it hydrate against the older values.
		`,
		details: (): string => prose`
			A region's answer was rendered against newer \`page.data\` than the Kit page in the
			browser holds, so the islands inside it would hydrate against older values. Call
			\`invalidateAll()\` before refreshing the region.
		`
	},
	kit_page_waiting: {
		text: (a: { seconds: number; booted: boolean }): string => prose`
			islands inside a lake / hole answer on this Kit (csr=true) page have waited ${a.seconds}s
			for Kit to apply its page and are still holding their server HTML.
			${
				a.booted
					? "Kit's client entry evaluated but start() has not applied the page (status is still -1) — Kit's start() may have thrown; check the console above."
					: "Kit's client entry has not evaluated (no page bridge yet) — Kit's boot script may be blocked, failing, or missing."
			}
			They hydrate the moment Kit does; nothing is discarded meanwhile.
		`,
		details: (): string => prose`
			Dev only. On a csr=true page, an island inside a lake or a hole answer waits for Kit to
			apply its page before it hydrates. Kit has not done so yet.

			\`booted=false\`: Kit's client entry never ran; its boot script is blocked, failing or
			missing. \`booted=true\`: it ran, but \`start()\` has not applied the page; it may have
			thrown, so check the console above. The islands keep their server HTML meanwhile.
		`
	},
	foreign_page_read: {
		text: (a: { expr: string; entry: string; origin: string }): string => prose`
			${a.expr} was read inside a mounted MFE island (${a.entry}, from ${a.origin}).

			In the browser this is the SHELL's page, not the MFE's. The HTML you see was rendered with
			the MFE's own load data, so this island will repaint with different values after hydrate.

			Pass the value as a prop, or read it with a remote function.
		`,
		details: (): string => prose`
			Dev only. An island from another app (a stitched fragment) read the page store. In the
			browser that is the host app's page, not the fragment's, so the island repaints with
			different values after it hydrates. Pass the value as a prop, or read it with a remote
			function.
		`
	}
};

type Core = MessagesOf<typeof ERRORS, typeof WARNINGS>;
const core: Core = /* @__PURE__ */ define_messages(
	import.meta.env.DEV ? ERRORS : null,
	import.meta.env.DEV ? WARNINGS : null
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs. Wording and link in dev,
 *  the link alone in a production build. */
export const OgygiaError: Core['OgygiaError'] = core.OgygiaError;
export const warn: Core['warn'] = core.warn;
