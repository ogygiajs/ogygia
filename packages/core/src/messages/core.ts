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
import { define_messages, type MessagesOf } from '../contract/messages.ts';
import { prose } from '../contract/prose.ts';
import { OG_PREFIX, OGYGIA_KEEP, OGYGIA_PREFIX } from '../wire-markup.ts';

const BUG = 'An ogygia bug: please report it with the page that shows it.';

/** Each message's arguments are its `text`'s: the one place they are written. */
/** The errors: `throw new OgygiaError(code, args)`, or `console.error(new OgygiaError(…), err)` for a
 *  failure that is caught. */
export const ERRORS = {
	context_missing: {
		text: (a: { key: string }): string => prose`
			context ${a.key} is not set above this component. Call the setter createContext returned
			in a component above it (in a csr=false layout, for regions), or ask has() first.
		`,
		details: (): string => prose`
			The getter \`createContext\` returns reads a value a component above set with its setter.
			Nothing above set one. Set it in a layout or a parent component; a value set in a
			csr=false layout reaches every region on the page. When the value is optional, call
			\`has()\` (the third item) before \`get()\`.
		`
	},
	request_event_server_only: {
		text: (): string => 'getRequestEvent is server-only',
		details: (): string => prose`
			\`getRequestEvent()\` was called in the browser. There is no request there: a deferred
			region's HTML is fetched from the server, so read the request in the component that
			renders on the server, and pass what the browser needs as props.
		`
	},
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
	island_code_refused: {
		text: (a: { url: string; entry: string }): string =>
			`refused island code from ${a.url} (for ${a.entry}): not an origin this page loads code from`,
		details: (): string => prose`
			An island's code was to load from an origin the page does not load code from. The runtime
			imports island code only from the page's own origin, its own (Kit's \`paths.assets\`), and
			the origins the server named on the runtime's script (a federated peer's, from
			\`federate({ peers })\`). Anything else came from the page's markup, not from ogygia: a
			region's \`entry\` or \`src\` written by content that is not the server's own render. The
			island stays as its server HTML.

			If the origin is one of your apps, declare it as a federation peer. If markup a visitor
			wrote can reach the page, check what keeps it from writing \`<ogygia-region>\` elements.
		`
	},
	client_hook_failed: {
		text: (a: { plugin: string; hook: string }): string =>
			`plugin \`${a.plugin}\`: its \`${a.hook}\` hook threw (or its promise rejected); the page and the other plugins carry on`,
		details: (): string => prose`
			A plugin's browser half subscribes to a runtime hook (or has a \`boot\`), and its function
			failed. The runtime calls every subscriber of a hook, and every \`boot\`, in plugin order and
			wraps each call, so one plugin's failure never stops another's hook, the boot or the page
			(its regions still wake). Said once per plugin and hook; the error
			follows the message. In dev the hook's payload is frozen: a hook that writes to it fails
			here too.
		`
	},
	kit_boot_failed: {
		text: (a: { url: string }): string => prose`
			SvelteKit's client code failed to load (${a.url}), so Kit cannot start on this page. The
			islands waiting for it stay as their server HTML.
		`,
		details: (): string => prose`
			On a csr=true page, an island inside a lake or a hole answer waits for SvelteKit to start
			before it hydrates. One of the files Kit's own boot script imports failed to download (the
			network dropped it, or the file is missing after a deploy), and the browser keeps that
			failure for the life of the page: Kit will not start. The waiting islands stop waiting and
			fail, and keep their server HTML. Reloading the page loads Kit again. Said once per file.
		`
	},
	chunk_reload_needed: {
		text: (a: { url: string }): string =>
			`a file this page needs cannot load until the page reloads: ${a.url}`,
		details: (): string => prose`
			A file the runtime loads when it needs it (an island's code, a part of the runtime) failed,
			and asking for it again failed the same way although the file itself came: one of the files
			it imports failed to download, and the browser keeps that failure for the life of the page.
			No retry can load it, so ogygia stops asking. The islands that need it stay as their server
			HTML until the page reloads. Said once per page.
		`
	},
	runtime_load_failed: {
		text: (): string => 'the ogygia runtime failed to load: no island on this page wakes',
		details: (): string => prose`
			The runtime's script, or one of the files it imports, failed to download (a dropped
			connection, a file a deploy removed). The runtime never ran, so every island on the page
			stays as its server HTML: links and forms still work, nothing interactive does. Reloading
			the page loads it again. Printed by the runtime's script tag itself, as the page link alone.
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
	page_promise_unresolved: {
		text: (a: { why: 'stream' | 'devalue' | 'answer' }): string =>
			a.why === 'stream'
				? 'a streamed page.data promise never got its value: the page loaded without it.'
				: a.why === 'answer'
					? "a streamed page.data promise never got its value: the page's data answer ended without it."
					: "a streamed page.data promise's value came, but the code to read it never loaded.",
		details: (): string => prose`
			A promise in \`page.data\` streams into islands: the page carries it pending, and a script
			later in the same response settles it. Here that can no longer happen, so the promise is
			rejected with this error and \`{#await}\` shows its catch branch instead of waiting
			forever. \`why=stream\`: the page finished loading with no value for it (the response was
			cut short, or something between the server and the browser dropped its end).
			\`why=devalue\`: the value came, but the browser could not download the code that reads it.
			\`why=answer\`: on the server, a region rendered outside its page (a hole, a remote call)
			reads the page's data from Kit's data answer, and that answer ended (it broke, or the
			request was over) before the promise's value came.
		`
	},
	slot_not_linked: {
		text: (a: { name: string }): string =>
			`runtime chunk used \`slots.${a.name}\` before the boot linked it`,
		details: (): string => BUG
	},

	// ── what crosses into an island (shared code: the page's render and the island's) ─────────────
	boundary_refused: {
		text: (a: { site: string; path?: string; detail: string; more?: number }): string =>
			`${a.site} — og.$ value${a.path ? ` @ ${a.path}` : ''}: ${a.detail}${a.more ? ` (+${a.more} more)` : ''}`,
		details: (): string => prose`
			A value marked with \`import.meta.og.$\` cannot cross into an island: a DOM node, a bare
			function, a class with no wire codec, a secret. It fails where it is marked, so the file
			and line point at it. Pass plain data, or give the class a codec.
		`
	},
	function_prop_cannot_cross: {
		text: (a: { where: string; reason: string }): string => prose`
			${a.where} is a function that can't cross the island boundary — ${a.reason}. Island props
			must be SERIALIZABLE; a function crosses only as a Svelte snippet that freezes to HTML, and
			this one didn't. Usually one of:

			• it's a PLAIN function (an event handler / callback) — those can't cross into an island;
			pass serializable data as props and keep the behavior inside the island component;

			• it's a snippet WITH PARAMETERS — declare it as a {#snippet} so it crosses LIVE, or pass
			its data as props;

			• it's children containing a NESTED island — keep those out of frozen children for now.
		`,
		details: (): string => prose`
			An island's props must be serializable. A function only crosses as a snippet that freezes
			to HTML, and this one could not.

			A plain function (an event handler, a callback) never crosses: keep the behavior inside the
			island and pass data. A snippet with parameters crosses live when it is declared as a
			snippet. Children that contain another island cannot be frozen yet.
		`
	},
	region_snippet_on_client: {
		text: (): string => prose`
			region_snippet(fn) freezes a snippet by server-rendering it — call it during SSR, not on
			the client. Pass a raw { render, setup } region snippet for client-constructed regions.
		`,
		details: (): string => prose`
			\`region_snippet(fn)\` renders the snippet on the server to freeze it. In the browser, build
			the region from a raw \`{ render, setup }\` snippet instead.
		`
	},
	raw_region_on_client: {
		text: (): string => prose`
			a \`with { region: 'raw' }\` component must be turned into a region on the server (the
			signer lives server-side). Call region() in a load / remote / render context, not in client
			code.
		`,
		details: (): string => prose`
			A held region is signed on the server, so \`region()\` on a \`with { region: 'raw' }\`
			component must run there: in a load, a remote function or a render.
		`
	},
	held_region_plain_import: {
		text: (): string => prose`
			a held region reached the wire but its component is a plain import, so nothing built a
			chunk for it. \`await\` the region before returning it from a remote/load — an awaited
			region bakes its SSR HTML and crosses as an HTML-only ticket. Or import the component
			\`with { region: 'raw' }\` (or a \`wake:\` mark) to make it a signed, fetchable capability. On
			a csr=false page you can also skip the wire entirely: call \`get()\` in a universal
			\`+page.ts\` load / the component — its data reaches the render by reference.
		`,
		details: (): string => prose`
			A region returned from a load or a remote function has to travel: as HTML, or as a signed
			address the browser fetches. This one's component was imported plainly, so neither exists.

			\`await\` the region (it then travels as its HTML), or import the component
			\`with { region: 'raw' }\` or with a \`wake\` mark.
		`
	},
	region_version_invalid: {
		text: (a: { version: string }): string =>
			`region() was given a version that is not a number, a Date or a date string: ${a.version}`,
		details: (): string => prose`
			\`region(C, props, { version })\` takes how new the data behind the region is, so the
			browser can keep the newest answer when two arrive for the same region. The version must
			be a number, a \`Date\`, or a string \`Date.parse()\` reads (an ISO date). This one is none of
			those, or is \`NaN\`.

			Pass the row's update time (\`row.updatedAt\`) or a counter that only goes up.
		`
	},
	keep_fallback_inline: {
		text: (): string => prose`
			keepFallback() ran inside the PAGE render: this server island is nested inside a \`wake\`
			island, where \`render: "deferred"\` is ignored and its component renders inline — nothing
			catches the signal there and its fallback never shows. Move the island out of the
			enclosing island (into the page, a layout, or a lake), or drop keepFallback() from a
			component that can render inline.
		`,
		details: (): string => prose`
			\`keepFallback()\` tells a deferred region to keep the page's fallback. Inside a \`wake\`
			island the region renders inline instead, so nothing can keep a fallback. Move the region
			out of the island (into the page, a layout or a lake).
		`
	},
	keep_fallback_signal: {
		text: (): string => 'keepFallback(): the page fallback stands',
		details: (): string => prose`
			Not an error: the signal \`keepFallback()\` throws to end a deferred region's render. You
			only see it when something catches and logs every error the render throws.
		`
	},
	preference_default_invalid: {
		text: (a: { name: string; fallback: string; values: string }): string =>
			`preference('${a.name}'): default '${a.fallback}' is not one of values [${a.values}]`,
		details: (): string => prose`
			A preference's \`default\` must be one of its \`values\`.
		`
	},
	fn_factory_missing: {
		text: (a: { tag: string }): string => prose`
			fn_handle("${a.tag}"): its factory is not registered on this side. The generated module
			must be imported as a VALUE at the call site (the compiler emits this import).
		`,
		details: (): string => prose`
			A function marked to cross into an island is rebuilt on the other side from a factory the
			compiler generates. That factory's module was not imported here. Import it as a value, not
			\`import type\`.
		`
	},
	fn_factory_not_function: {
		text: (a: { tag: string }): string => `fn factory "${a.tag}" did not return a function.`,
		details: (): string => BUG
	},
	fn_revive_missing: {
		text: (a: { tag: string }): string => prose`
			cannot revive fn "${a.tag}": its factory is not in this side's build. A function travels
			as its tag only, never its source, so the island must import the generated module as a
			VALUE so \`__register_fn\` runs in its bundle (or the fn manifest must be in the runtime).
		`,
		details: (): string => prose`
			An island received a function it cannot rebuild: the module that registers its factory is
			not in the island's bundle. Import that module as a value in the island.
		`
	},
	transportable_class_missing: {
		text: (a: { tag: string }): string => prose`
			cannot revive transportable "${a.tag}": its class is not loaded on this side. The island
			must import the class as a VALUE (not \`import type\`) so its codec travels with the
			island's bundle.
		`,
		details: (): string => prose`
			An island received an instance of a wired class whose module it never imports, so the
			class's codec is not there to rebuild it. Import the class as a value in the island.
		`
	},
	transportable_unregistered: {
		text: (a: { name: string }): string => prose`
			class "${a.name}" has a [import.meta.og.wire] codec but was never registered. Transportable
			classes must be declared in a module the ogygia vite plugin transforms (an \`export class\`
			in your app source, not node_modules or a dynamic eval).
		`,
		details: (): string => prose`
			A class with a wire codec is registered by the ogygia Vite plugin while it compiles the
			class's module. This class was declared somewhere the plugin does not compile. Declare it
			as an \`export class\` in the app's source.
		`
	},
	ref_kind_missing: {
		text: (a: { kind: string }): string => prose`
			cannot resolve a "${a.kind}" ref: no such kind is registered on this side. The module that
			registers it must be imported as a VALUE in this bundle.
		`,
		details: (): string => prose`
			A value crossed into an island as a reference of a kind this bundle does not know. Import
			the module that registers that kind as a value.
		`
	},
	continuity_id_collision: {
		text: (a: { name: string; owner: string; tag: string }): string => prose`
			two transportables both use continuity id "${a.name}" ("${a.owner}" and "${a.tag}"). A
			continuity id must be unique per class — rename one, or they will clobber each other in the
			session Keep.
		`,
		details: (): string => prose`
			Two different wired classes claim the same continuity id, so they would share one kept
			instance. Give each class its own id.
		`
	},
	og_derived_formula_missing: {
		text: (): string => prose`
			cannot resume og_derived: its formula did not cross — mark it with import.meta.og.$ at the
			og_derived call site so it travels as a fn ref.
		`,
		details: (): string => prose`
			An \`og_derived\` crossed into an island without its formula. Mark the formula with
			\`import.meta.og.$\` where \`og_derived\` is called, so it travels too.
		`
	},

	// ── script() ─────────────────────────────────────────────────────────────────────────────────
	script_run_not_function: {
		text: (): string => 'script(): `run` must be a function',
		details: (): string =>
			'`script({ run })` takes a function, which it inlines as the script body.'
	},
	script_imports_need_module: {
		text: (): string =>
			"script(): `imports` needs `type: 'module'` (a static import only works in a module)",
		details: (): string =>
			"`imports` become static `import` lines, which only work in a module: add `type: 'module'`."
	},
	script_import_not_url: {
		text: (a: { name: string }): string => `script(): \`imports.${a.name}\` must be a URL string`,
		details: (): string => 'Each entry of `imports` is a module URL, as a string.'
	},
	script_run_rewritten: {
		text: (): string => prose`
			script(): \`run\` was rewritten by the bundler (it holds \`__vite_ssr_…\`): an \`import()\` or
			an imported binding inside it cannot cross into the browser. Declare the module in
			\`imports\` (with \`type: 'module'\`) and read it from \`run\`'s first parameter.
		`,
		details: (): string => prose`
			\`run\` is inlined into the page as its source, so it cannot use what Vite rewrites for
			the server: an \`import()\` or an imported binding. Declare the module in \`imports\` and
			read it from \`run\`'s first parameter.
		`
	},
	script_not_json: {
		text: (a: { key: string }): string => `script(): \`${a.key}\` must be JSON-serializable`,
		details: (): string =>
			'The value is written into the page as JSON, so it must serialize to JSON.'
	},
	script_one_kind: {
		text: (a: { count: number }): string =>
			`script(): pass exactly one of \`run\`, \`json\`, \`ld\`, \`importmap\`, \`speculation\` (got ${a.count})`,
		details: (): string =>
			'A script has one body: pass one of `run`, `json`, `ld`, `importmap` or `speculation`.'
	},
	script_bad_attribute: {
		text: (a: { key: string }): string => `script(): \`${a.key}\` is not an attribute name`,
		details: (): string =>
			'Options other than the body become attributes of the script element, so each must be a valid attribute name.'
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
	region_answer_older: {
		text: (a: { address: string; version: number; shown: number }): string => prose`
			an answer for region ${a.address} arrived with data version ${a.version}, older than the
			${a.shown} on screen: it was dropped, and the newer answer stays.
		`,
		details: (): string => prose`
			Two answers for the same region reached the browser (two commands that both return it,
			say), and the older one arrived last. Each carries the version its server gave it with
			\`region(C, props, { version })\`, so the browser kept the one with the newer data. Nothing
			to fix: this is what the version is for. It shows in dev so a version that does not move
			when the data does is easy to spot.

			Equal versions, and answers without a version, keep the one that arrived last.
		`
	},
	region_wake_unknown: {
		text: (a: { region: string; value: string }): string => prose`
			region ${a.region}: its wake "${a.value}" is not a trigger, so it wakes on load. Use
			load, idle, visible, interaction or a media query.
		`,
		details: (): string => prose`
			A region's \`wake\` (or a hole's \`when\`) names when it runs: \`load\`, \`idle\`,
			\`visible\`, \`interaction\`, or a media query (a \`(\` with a \`)\` after it). This one
			names none of them: a typo, or a value an app computed at runtime (\`region()\`'s
			options). The build refuses an unknown value it can see on an import; this one reached
			the page. The region wakes on load, the one fallback for a value no trigger holds.

			Fix the value where it is made.
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
			${
				/^(sig|shape|foreign-key)\b/.test(a.deny) &&
				prose`
					It was asked twice: in a rolling deploy, a server of an older or newer ogygia build
					refuses a capability it cannot check, and the second ask usually reaches one of the
					page's own build. Both were refused.
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

			\`sig\`, \`shape\`, \`foreign-key\`: these are about the server that answered, so the
			runtime asks once more before it gives up. In a rolling deploy, a server of an older or
			newer ogygia build cannot check a capability the page's build signed; the second ask
			usually reaches a server of the page's own build. Both asks were refused. If this happens
			only during deploys, drain the old servers before new pages go out.

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
			(wake: 'none'), or mark the element ${OGYGIA_KEEP}.
		`,
		details: (): string => prose`
			Dev only. A web component inside the island added children where Svelte's hydration
			expects the server's nodes. To hydrate the island, the repair removed them.

			Render that subtree with \`{@html}\` or as static markup (Svelte never reads inside it),
			put it in a lake (\`wake: 'none'\`), or mark the element \`${OGYGIA_KEEP}\`.
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
		text: (): string => 'live region needs the live feature plugin (pushable props missing)',
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
	},

	// ── what crosses into an island (shared code) ────────────────────────────────────────────────
	context_marker_large: {
		text: (a: { size: string; top: string }): string => prose`
			the island context marker is ${a.size}kB — it ships in every page's HTML. Biggest keys:
			${a.top}. Slim the values, or mark host-only keys with setContext(key, value, { islands:
			false }).
		`,
		details: (): string => prose`
			Dev only. Context set above islands is serialized into the page so the islands can read it,
			and it has grown large. Slim the values, or keep a key on the server with
			\`setContext(key, value, { islands: false })\`.
		`
	},
	context_dropped: {
		text: (a: { key: string }): string => prose`
			context ${a.key} could not be serialized for regions and was dropped: regions read
			undefined. Pass plain data, or a wired class for a value with methods; or set it with {
			islands: false } if no region reads it.
		`,
		details: (): string => prose`
			A context value set above regions could not be serialized, so regions in the browser do
			not see it. Pass plain data. For a value with methods, make it a wired class (\`static
			wire = import.meta.og.wire(…)\`): every region gets the one live instance. If no region
			reads the key, set it with \`setContext(key, value, { islands: false })\`.
		`
	},
	context_unserializable: {
		text: (a: { key: string; path?: string; detail: string }): string =>
			`context ${a.key}${a.path ? ` @ ${a.path}` : ''}: ${a.detail}`,
		details: (): string => prose`
			Part of a context value set above regions does not cross into them: \`path\` names where,
			\`detail\` what. Pass plain data there, or a wired class (\`static wire =
			import.meta.og.wire(…)\`) for a value with methods.
		`
	},
	context_key_one_off: {
		text: (a: { key: string }): string => prose`
			context key ${a.key} is a one-off Symbol(), so it cannot cross into regions: they read
			undefined in the browser. Key it with a string or Symbol.for('name'); or set it with {
			islands: false } if no region reads it.
		`,
		details: (): string => prose`
			Each region wakes as its own root in the browser, so it reads context the page carries
			across. A one-off \`Symbol()\` key has no twin there: nothing in the browser can name it.
			Use a string key, or \`Symbol.for('name')\`, which the browser rebuilds from its name (or
			\`createContext\` from \`ogygia\`). If no region reads the key, set it with
			\`setContext(key, value, { islands: false })\`.
		`
	},
	context_value_function: {
		text: (a: { key: string }): string => prose`
			context ${a.key} is a function, so it cannot cross into regions: they read undefined in
			the browser. Put the methods on a wired class; or set it with { islands: false } if no
			region reads it.
		`,
		details: (): string => prose`
			A function cannot be serialized into the page, so a region in the browser never sees it.
			For a value with methods, make it a wired class (\`static wire =
			import.meta.og.wire(…)\`) and set an instance: every region gets the one live instance.
			A single server function can be marked with \`import.meta.og.$\`. If no region reads the
			key, set it with \`setContext(key, value, { islands: false })\`.
		`
	},
	page_seed_ref_missing: {
		text: (a: { path: string }): string => prose`
			island props reference page.data at ${a.path} but the page seed does not carry it — the
			island receives undefined there.
		`,
		details: (): string => prose`
			Dev only. An island's props point into \`page.data\`, but the page did not ship that part,
			so the island reads \`undefined\` there.
		`
	},
	page_payload_unreadable: {
		text: (a: { what: string }): string => prose`
			the page's ${a.what} could not be read back, so islands go on without it. The error follows.
		`,
		details: (): string => prose`
			Dev only. The server wrote data into the page for its islands (the page seed, the page
			facts, the holes record, the context marker, remote functions' data), and the browser could not decode it. The
			usual cause is a custom type the server's \`transport\` encodes and the browser has no
			decoder for. Islands then read nothing there. Give the type a decoder in \`transport\`
			(hooks.ts), or pass plain data.
		`
	},
	store_not_extensible: {
		text: (a: { tag: string }): string => prose`
			store "${a.tag}": the store object is not extensible (frozen/sealed), so it cannot carry
			its factory brand — it will cross boundaries as a plain writable (custom methods
			unavailable). Brand before freezing, or leave the store extensible.
		`,
		details: (): string => prose`
			A store crosses into an island with a mark naming the factory that rebuilds it. A frozen
			store cannot take the mark, so it crosses as a plain writable. Freeze it after it is
			branded, or leave it extensible.
		`
	},
	store_factory_missing: {
		text: (a: { tag: string }): string => prose`
			store "${a.tag}": factory not loaded in this bundle — degraded to a plain writable (custom
			methods unavailable). Import the factory's module in the island (or its graph) so
			\`__register_store_factory\` runs there.
		`,
		details: (): string => prose`
			The island received a store whose factory module it never imports, so the store arrives
			as a plain writable. Import that module in the island.
		`
	},
	store_factory_bad_rebuild: {
		text: (a: { tag: string; got: string }): string => prose`
			store "${a.tag}": factory returned ${a.got} while rebuilding — degraded to a plain writable
			(custom methods unavailable). A store factory must return a store on every call; move
			environment guards inside the factory body.
		`,
		details: (): string => prose`
			A store factory returned something other than a store while the island rebuilt it. Return
			a store on every call, and put environment checks inside the factory's body.
		`
	},
	store_factory_unbranded: {
		text: (a: { tag: string; got: string }): string => prose`
			store "${a.tag}": factory returned ${a.got} — nothing to brand, value passed through as-is.
			Fine for a client-only store; a store that must cross an island boundary has to exist on
			the server too — return e.g. writable(seed) under your guard and gate the side effects
			inside the factory instead.
		`,
		details: (): string => prose`
			A store factory returned something other than a store, so it cannot be marked to cross
			into islands. That is fine for a store only the browser uses; to cross, the factory must
			return a store on the server too.
		`
	},
	region_promise_no_placeholder: {
		text: (): string => prose`
			<Region of={promise}> has no \`placeholder\` — the region will sit empty until the promise
			resolves and its stylesheet loads. Add {#snippet placeholder()}…{/snippet} for the wait.
		`,
		details: (): string => prose`
			Dev only. A region given a promise shows nothing until it resolves. Give it a
			\`placeholder\` snippet for the wait.
		`
	},
	nested_server_island_inline: {
		text: (a: { entry: string }): string => prose`
			nested server island "${a.entry}" is inside another island; it renders inline as frozen
			HTML (no JS ships; islands inside it wake on their own) — 'deferred' ignored.
		`,
		details: (): string => prose`
			Dev only. A deferred region inside an island cannot be fetched on its own, so it renders
			inline as part of the island's HTML.
		`
	},
	nested_island_with_parent: {
		text: (a: { entry: string }): string =>
			`nested island "${a.entry}" is inside another island; it hydrates with its parent (strategy ignored).`,
		details: (): string => prose`
			Dev only. An island inside an island hydrates with the outer one, so its own \`wake\` is
			ignored when it differs from the outer island's. Put a lake (\`wake: 'none'\`) between them
			to give it its own schedule.
		`
	},
	lake_mounted_without_html: {
		text: (a: { entry: string }): string => prose`
			lake "${a.entry}" was mounted by Kit on the client with no server HTML to adopt (a
			client-side navigation, or a hydration failure — look for an error above). The runtime
			restores it from its server HTML when this document rendered it; otherwise it stays empty.
			A lake is server HTML: keep chrome lakes in a layout that persists across navigations, or
			serve that route csr=false.
		`,
		details: (): string => prose`
			Dev only. On a csr=true page Kit mounted a lake in the browser, but a lake is server HTML
			and there was none to adopt. Keep such lakes in a layout that stays across navigations, or
			serve the route with \`csr = false\`.
		`
	},
	rule_region_mounted_twice: {
		text: (a: { detail: string }): string => `rule broken, one mount per region: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). A region element holds one island at a
			time, and an island whose element left the page is let go with it. One held two, or kept
			its island after its element left: ${BUG}
		`
	},
	rule_address_bar_drift: {
		text: (a: { detail: string }): string =>
			`rule broken, the address bar and the router's history agree: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). With no navigation out, the address bar
			is the router's page on screen. They differ: a later back or forward step would show the
			wrong page, or scroll to the wrong place. If the app writes \`history\` itself (outside
			\`pushState\`/\`replaceState\` from \`$app/navigation\`), that is the likely cause; else
			${BUG}
		`
	},
	rule_old_page_open: {
		text: (a: { detail: string }): string =>
			`rule broken, nothing of a page that was left stays open: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). Each page the router shows owns what it
			starts (listeners, timers, streams), and all of it is let go when the next page takes over.
			Something of an earlier page is still open: ${BUG}
		`
	},
	rule_failure_uncoded: {
		text: (a: { detail: string }): string =>
			`rule broken, no failure leaves ogygia without a code: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). Every failure ogygia lets out names its
			code's page, and its internal \`STALE\` answer is never a rejection. One got out without
			either: ${BUG}
		`
	},
	rule_markup_known: {
		text: (a: { detail: string }): string =>
			`rule broken, every page marker is declared: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). The page markup ogygia writes and reads
			back (its \`${OG_PREFIX}*\` and \`${OGYGIA_PREFIX}*\` attributes) is declared in one table, so a writer
			and a reader never meet through a name only one of them spells. The page carries a marker
			the table does not declare: a renamed or misspelled one, or a new one not added to it. Only
			ogygia's own markers are read: any \`${OGYGIA_PREFIX}*\`, and \`${OG_PREFIX}*\` on an \`ogygia-*\`
			element. An app's own \`${OG_PREFIX}*\` elsewhere is left alone.
			${BUG}
		`
	},
	rule_region_answer_behind: {
		text: (a: { detail: string }): string =>
			`rule broken, a region shows the answer its address holds: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). Every answer for a deferred region lands in
			one store, by the region's address, and the store keeps the newest (by when it was asked
			for). Each region bound to that address paints what the store holds. One region was left
			on an older answer, or never got the newest. ${BUG}
		`
	},
	rule_region_left_busy: {
		text: (a: { detail: string }): string =>
			`rule broken, a region that left the page is at rest: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). A region element runs a few state
			machines: its fetch, its wake, its live mode, its paint. When the element leaves the page,
			each goes back to rest, so nothing of it waits on something that can no longer happen. One
			of them was still in the middle of its work after the element left. ${BUG}
		`
	},
	rule_parse_upgraded: {
		text: (a: { detail: string }): string => `rule broken, a parsed answer is inert: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). A region or hole answer is parsed in a
			document with no browsing context, so no component's constructor runs before the restore
			puts the answer in the shape its components expect. An element of an answer was built
			during the parse anyway: the engine built custom elements in a document that has no
			registry. ${BUG}
		`
	},
	rule_lake_restored: {
		text: (a: { detail: string }): string =>
			`rule broken, a hydrate gives back every lake it lifted: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). Before an island hydrates, the server
			HTML of each region inside it that never wakes (a lake) is lifted out, and after the
			hydrate it goes back into the lakes the island rendered, the first into the first. The
			island rendered a different number of lakes than it had, so one lake's content was lost or
			one lake was left empty. A lake that renders on the server only, or only in the browser
			(an \`{#if browser}\`), does this; else ${BUG}
		`
	},
	rule_turns_counted: {
		text: (a: { detail: string }): string =>
			`rule broken, the hydration scheduler holds every turn it counts: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). Islands that are ready to hydrate wait
			for a turn, one per task, the ones on screen first. The scheduler keeps a count of the
			turns waiting and picks the next one from two lists, on screen and not. The count and the
			lists disagree, so the next pick could find nothing and islands could wait forever. ${BUG}
		`
	},
	rule_head_adopted: {
		text: (a: { detail: string }): string =>
			`rule broken, the head gains no <base> or refresh, CSP or cookie meta: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). A \`<base>\` re-points every relative
			fetch on the page, and a \`meta[http-equiv]\` that refreshes, sets a content security policy
			or sets a cookie acts the moment it lands, so a navigation never adopts one from a fetched
			page: only the first document's own count. One came into the head later. If the app adds it
			itself, set it in the first document's head or as an HTTP header (a CSP header cannot be
			loosened by a meta); else ${BUG}
		`
	},
	rule_seed_key_unshipped: {
		text: (a: { detail: string }): string =>
			`rule broken, island code reads only the page.data keys the page shipped: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e builds only (a rule ogygia checks on itself). With \`dataShake()\` listed, the
			build reads each island's code for the \`page.data\` keys it reaches, and the page seed
			ships only those. Island code read a key the server had and the seed left out, so it saw
			\`undefined\`. A read the analysis missed: please report it with the island's code.
			Removing \`dataShake()\` ships all of \`page.data\` again.
		`
	}
};

type Core = MessagesOf<typeof ERRORS, typeof WARNINGS>;
// (`?.`: a plain Node import — a vite.config, a script — has no `import.meta.env`; it gets the link)
const core: Core = /* @__PURE__ */ define_messages(
	import.meta.env?.DEV ? ERRORS : null,
	import.meta.env?.DEV ? WARNINGS : null
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs. Wording and link in dev,
 *  the link alone in a production build. */
export const OgygiaError: Core['OgygiaError'] = core.OgygiaError;
export const warn: Core['warn'] = core.warn;
export const line: Core['line'] = core.line;
