/**
 * EVERY MESSAGE OGYGIA'S SERVER PRINTS — the handle, the islands endpoint, region capabilities, the
 * page a render outside Kit reads: their code, their wording, what to do about them. Same calls as
 * the runtime's (./core.ts): the wording and the code's page in dev and while prerendering; a
 * production server prints the page's link alone.
 *
 *   throw new OgygiaError('handle_secret_too_short', { min });
 *   warn('endpoint_bad_signature', { id });
 */
import { define_messages, dev_or_prerender, type MessagesOf } from '../contract/messages.ts';
import { prose } from '../contract/prose.ts';

const SECRET_FIX =
	'Set a stable `OGYGIA_SECRET` in the server environment, or pass one to `handle({ secret })`.';

/** The errors: `throw new OgygiaError(code, args)`, or `console.error(new OgygiaError(…))`. */
export const SERVER_ERRORS = {
	plugin_capability_message: {
		text: (a: { name: string }): string =>
			`the \`${a.name}\` plugin signed or checked a capability message with its plain \`sign\` / \`verify\`.`,
		details: (): string => prose`
			A message that starts \`cap|\` is a signed hole's, and a signed hole is opened only through
			\`app.capability.open\`: it charges the visitor's rate budgets in order (the probe before
			the signature, the render after), as a region hole does. Mint with \`app.capability.mint\`
			and open with \`app.capability.open\`, or sign a message that does not start \`cap|\`.
		`
	},
	remote_arg_not_data: {
		text: (a: { kind: string }): string => prose`
			a remote function's argument carried an ogygia ${a.kind} value. Arguments sent from the
			browser must be plain data.
		`,
		details: (): string => prose`
			A remote function was called from the browser with an argument that holds an ogygia value:
			a region, a snippet, a function, a wired class instance, a store or a derived store. The
			server refuses it with a 400 and runs nothing. Those values travel from the server to the
			browser only.

			Send the plain data the server needs instead (an id, the props, a slug), and build the
			value on the server from it.
		`
	},
	handle_secret_too_short: {
		text: (a: { min: number }): string =>
			`handle({ secret }) is too short for production (need ≥${a.min} UTF-8 bytes).`,
		details: (): string => prose`
			A production build signs region capabilities with the secret passed to
			\`handle({ secret })\`, and a short one can be guessed. Use a random secret at least as long
			as the message says, from the server's environment.
		`
	},
	handle_transform_moved: {
		text: (): string => prose`
			handle({ transform }) moved to @ogygia/reshape: list reshape() beside ogygia() in
			vite.config, and pass the transform to reshape.handle(transform), before ogygia.handle()
			in sequence().
		`,
		details: (): string => prose`
			An app's own pass over the HTML ogygia sends (a web-component server render, say) is the
			\`@ogygia/reshape\` package now, so apps without one ship none of its support.

			In vite.config, list \`reshape()\` (from \`@ogygia/reshape/vite\`) beside \`ogygia()\`. In
			hooks.server.ts, \`import * as reshape from '@ogygia/reshape'\` and export
			\`sequence(reshape.handle(transform), ogygia.handle())\`. The transform itself is
			unchanged: \`(html, { kind, csr, event })\` in, HTML out.
		`
	},
	secret_conflict: {
		text: (a: { key: string; decided: string; from: string }): string => prose`
			handle({ secret }) names key ${a.key}, but this server already signs with key ${a.decided}
			(from ${a.from}). The first key stays: pass one secret, before anything renders.
		`,
		details: (): string => prose`
			The server decides its signing key once, the first time it mints or verifies a region
			capability. A second, different secret arrived after that, and is ignored: every
			capability keeps verifying with the first key.

			Pass one secret, to the one \`handle()\`, before anything renders.
		`
	},
	islands_endpoint_conflict: {
		text: (a: { endpoint: string; was: string }): string => prose`
			handle({ endpoint }) names ${a.endpoint}, but this server already answers holes on
			${a.was}. ${a.was} stays: pass one endpoint, to the one \`handle()\`.
		`,
		details: (): string => prose`
			A server has one islands endpoint: the path the handle answers holes on, and the path
			every capability is minted for. It is decided once, by the first \`handle()\` (or the
			first render, when none named one), and never moves: pages already minted and the handle
			that answers them must name the same path. A later \`handle()\` named another one, so
			its endpoint is not used. Two copies of ogygia in one server, or two \`handle()\` calls,
			are the usual cause; one with no \`endpoint\` names the default, \`/__ogygia__\`.

			Pass one \`endpoint\`, to the one \`handle()\`. Thrown in dev; in production it is said
			and the first path stays.
		`
	},
	secret_missing_at_runtime: {
		text: (): string => prose`
			OGYGIA_SECRET was set when this app was built but is not set where it runs: region
			capabilities are signed with this build's random key, so every hole minted by another
			deployment (another backend behind the same CDN, the previous deploy) is refused (403,
			x-ogygia-deny: foreign-key). Set OGYGIA_SECRET in the server's runtime environment, or pass
			it to handle({ secret }) (e.g. from $env/static/private).
		`,
		details: (): string => prose`
			The build saw \`OGYGIA_SECRET\` but the running server does not, so it signs with a random
			key of its own. A page from another deployment carries capabilities signed with another
			key, and the islands endpoint refuses them (\`x-ogygia-deny: foreign-key\`).

			${SECRET_FIX}
		`
	},
	hole_props_too_large: {
		text: (a: { entry: string; length: number; max: number }): string => prose`
			server island "${a.entry}": props payload is ${a.length} b64 chars (max ${a.max}). Shrink
			what you pass into the deferred region — the handle would reject this capability anyway.
		`,
		details: (): string => prose`
			A deferred region's props travel inside its signed address, so they have a size limit.
			Pass less: an id the region looks up on the server instead of the record itself.
		`
	},
	prop_not_serializable: {
		text: (a: { entry: string; detail: string }): string => prose`
			island "${a.entry}": a captured prop is not serializable — ${a.detail}. Captured host values
			cross the boundary via devalue; functions/Promises cannot, and a class instance only can
			when the class declares a static [ogygia.wire] codec. Pass a serializable value, add a
			codec, or move that logic inside the island component.
		`,
		details: (): string => prose`
			An island's props are serialized into the page so the browser can hydrate it. Functions
			and promises cannot be serialized, and a class instance can only when its class declares
			a wire codec.

			Pass plain data, give the class a codec, or move the logic inside the island.
		`
	},
	island_deps_handoff_missing: {
		text: (a: { kind: string; tried: string; error: string }): string => prose`
			the client build's handoff (og-region-deps.json) is ${a.kind}${a.error ? ` (${a.error})` : ''}:
			server-rendered regions go out without their CSS and preloads. Tried: ${a.tried}.
		`,
		details: (): string => prose`
			The client build writes a handoff the server reads as it renders: each island's CSS
			and code chunks, and what each reads of the page. It is inlined into the server bundle
			when the build can, and otherwise read from \`og-region-deps.json\` beside the server
			output. This server found none (\`missing\`), or found one that did not read or parse
			(\`unreadable\`). Until it has one, a hole renders unstyled, no island code is preloaded
			and every page ships its whole seed.

			A missing file usually means the deploy dropped it: ship the server output whole, or
			let the build inline it (an adapter whose file tracing drops runtime reads needs the
			inlined copy). An unreadable one is tried again on the next request.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const SERVER_WARNINGS = {
	region_render_failed: {
		text: (): string => 'region render failed:',
		details: (): string => prose`
			A region's server render threw, so the islands endpoint answered 500 and the page keeps
			the region's fallback. The error follows the message, in the server's log only: the
			visitor's answer says nothing of it.
		`
	},
	rate_limit_shared_address: {
		text: (a: { address: string }): string =>
			`the region render budget is spent for ${a.address}, a proxy's address: every visitor behind it shares one budget`,
		details: (): string => prose`
			The islands endpoint's render budget (\`ogygia({ rateLimit })\`) is per client address, the
			one your adapter gives (\`event.getClientAddress()\`). This address is private, loopback or
			link-local, so no visitor has it: it is a reverse proxy's or a load balancer's, and every
			visitor behind it shares one budget, so normal traffic gets 429s. Tell your adapter which
			header holds the visitor's address (adapter-node: \`ADDRESS_HEADER\`, with \`XFF_DEPTH\` for
			\`X-Forwarded-For\`). Said once per server.
		`
	},
	region_render_abandoned: {
		text: (a: { ms: number }): string =>
			`a region render ran past ${a.ms} ms and was abandoned: its hole kept its fallback`,
		details: (): string => prose`
			A hole's render did not finish within its deadline, so the islands endpoint answered with
			the fallback and gave the render's slot to the next hole. The render still runs (a render
			cannot be cancelled) until what it awaits ends. Renders that outlive their deadline usually
			await an upstream that hangs: give that fetch a timeout of its own. Said once each time a
			render is abandoned while no other is.
		`
	},
	page_promise_pending: {
		text: (a: { path: string; ms: number }): string =>
			`a promise in the load data of ${a.path || 'a page'} is still pending after ${a.ms} ms: its response stays open until it settles`,
		details: (): string => prose`
			Dev only. A load returned a promise (Kit streaming), and the page's response waits for it:
			a page load streams its value into islands after the document, a router fetch settles it
			before the document goes out. There is no deadline: a slow stream is allowed, and the wait
			ends when the visitor leaves. A promise that never settles keeps the response open (and,
			on a router fetch, the page unsent) for as long as the visitor stays. Give the work behind
			it a timeout of its own. Said once per response.
		`
	},
	endpoint_props_decode_failed: {
		text: (): string => 'region endpoint 403: island module load / props decode failed',
		details: (): string => prose`
			The islands endpoint could not load the region's module, or could not decode the props in
			its address, so it refused the request and the page keeps the region's fallback. The
			error follows the message, in the server's log only: the visitor's answer says nothing of
			it.
		`
	},
	endpoint_foreign_key: {
		text: (a: { id: string; key: string; own: string }): string =>
			`region endpoint 403: id "${a.id}" was signed by key ${a.key}, this server signs with ${a.own}`,
		details: (): string => prose`
			Dev only. The region's address was signed by another deployment's key. Route the islands
			endpoint to the deployment that served the page, or give every deployment the same
			\`OGYGIA_SECRET\`.
		`
	},
	endpoint_bad_signature: {
		text: (a: { id: string }): string => `region endpoint 403: bad signature for id "${a.id}"`,
		details: (): string => prose`
			Dev only. The region's address does not carry a valid signature: it was edited, or
			truncated on the way. The endpoint refuses it.
		`
	},
	endpoint_unknown_id: {
		text: (a: { id: string; component?: string; known: number }): string =>
			`region endpoint 403: id "${a.id}"${a.component ? ` (component ${a.component})` : ''} is not in the server manifest (${a.known} known)`,
		details: (): string => prose`
			Dev only. The address names a region this server's build does not have: the page came
			from another build, or the region was renamed. After a deploy the page reloads its
			regions from the current build.
		`
	},
	live_props_not_serializable: {
		text: (a: { entry: string; max: number }): string => prose`
			render:'live' region ${a.entry} has props that cannot cross the wire (non-serializable or
			>${a.max} b64 chars) — no revalidate endpoint minted (behaves like a static lake).
		`,
		details: (): string => prose`
			A live region refreshes from a signed address that carries its props. These props cannot
			be serialized, or are too large, so the region gets no address and never refreshes. Pass
			plain, small props.
		`
	},
	build_key_prerender: {
		text: (): string => prose`
			prerendered page mints region capabilities signed with a per-build random key — they stop
			verifying after your next deploy while the static HTML lives on. Set a stable
			OGYGIA_SECRET env var (or pass it to handle({ secret })) so prerendered holes survive
			redeploys.
		`,
		details: (): string => prose`
			A prerendered page keeps the addresses of its holes in static HTML. Signed with a random
			per-build key, they stop verifying after the next deploy. ${SECRET_FIX}
		`
	},
	secret_missing: {
		text: (): string => prose`
			OGYGIA_SECRET is not set: region capabilities are signed with this build's random key, so
			a page cached across a deploy, or served by another deployment than its islands endpoint,
			gets its holes refused (403, x-ogygia-deny: foreign-key). Set a stable OGYGIA_SECRET, or
			pass one to handle({ secret }).
		`,
		details: (): string => prose`
			Without a secret, each deployment signs with its own random key. A page cached across a
			deploy, or served by one backend while another answers its islands endpoint, gets its holes
			refused. ${SECRET_FIX}
		`
	},
	outside_page_data_unavailable: {
		text: (a: { path: string; miss: string }): string =>
			`${a.path}: the page's data for a render outside it is unavailable: ${a.miss}. The render sees an empty page.data.`,
		details: (): string => prose`
			A region rendered outside its page (an islands endpoint request) reads that page's
			\`page.data\`, which ogygia looks up from the page. The lookup failed for the reason given,
			so the region rendered with an empty \`page.data\`.
		`
	},
	outside_page_data_key: {
		text: (a: { path: string; key: string }): string => prose`
			${a.path}: a region rendered outside its page read page.data.${a.key}, which this page's
			server loads do not produce. A key a universal load (+page.ts / +layout.ts) returns exists
			only inside a full page render: return it from a server load, or pass it as a prop.
		`,
		details: (): string => prose`
			Outside a full page render only the server loads run. A key a universal load returns
			(\`+page.ts\`, \`+layout.ts\`) is missing there. Return it from a server load, or pass it
			to the region as a prop.
		`
	},
	router_css_inactive: {
		text: (): string => prose`
			a page rendered outside Kit's routes, but no plugin declared page modules, so its
			components' CSS is not linked. Using \`@ogygia/router\`? List \`router()\` from
			\`@ogygia/router/vite\` beside \`ogygia()\` in vite.config \`plugins\`.
		`,
		details: (): string => prose`
			Dev only. A page rendered outside Kit's routes needs a plugin to name its modules so their
			CSS can be linked. With \`@ogygia/router\`, add \`router()\` from \`@ogygia/router/vite\` to
			the Vite plugins.
		`
	},
	plugin_hook_failed: {
		text: (a: { name: string }): string => `a \`${a.name}\` hook failed —`,
		details: (): string => prose`
			A plugin's hook threw. ogygia logs it and goes on with the next plugin. The error follows
			the message.
		`
	},
	personal_response_unmarked: {
		text: (a: { status: number }): string => prose`
			a page made for one browser (status ${a.status}) could not be marked private: its headers
			cannot be changed —
		`,
		details: (): string => prose`
			A page that carries something for one browser (its devtools events, the profiler's beacon,
			the devtools switch's cookie) is marked \`cache-control: private, no-store\` so no shared
			cache keeps it. This response's headers cannot be changed (a Response from \`fetch()\`, or
			\`Response.redirect()\`, handed back as it is), so it goes out with the headers it has, and a
			shared cache could keep it. The error follows the message. Return a new Response
			(\`new Response(res.body, res)\`) from the hook or route that made it.
		`
	},
	request_cleanup_failed: {
		text: (): string => `a cleanup at the end of a request failed —`,
		details: (): string => prose`
			Work a request started (a timer, a stream, a fetch) is let go when its response ends or
			its visitor leaves. One of those cleanups threw. The response was not affected. The error
			follows the message.
		`
	},
	rule_request_scope_open: {
		text: (a: { detail: string }): string =>
			`rule broken, a request's work ends with its response: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e builds only (a rule ogygia checks on itself). The work a request starts (its
			timers, streams, fetches) is let go once its response ends. A response ended with its
			request's work still held, which leaks with every request: an ogygia bug, please report it.
		`
	},
	rule_flight_kept_failure: {
		text: (a: { detail: string }): string =>
			`rule broken, no shared work keeps a failure: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e builds only (a rule ogygia checks on itself). Shared work (a render, a fetch
			that callers join) keeps its answer for the next caller, but never a failure: the next
			caller tries again. One kept an error as its answer, so every later caller gets it.
		`
	},
	rule_hole_page_read_unpredicted: {
		text: (a: { detail: string }): string =>
			`rule broken, a server island the build said reads no page.data read it: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e builds only (a rule ogygia checks on itself). With \`dataShake()\` listed, the
			build reads each server island's code for the \`page.data\` keys it reaches, and an island
			that reads none skips the page look-up. This one read a key anyway, so it rendered with
			\`undefined\` there. A read the analysis missed: please report it with the island's code.
			Removing \`dataShake()\` makes every server island look the page up.
		`
	},
	rule_kept_unkeyed_read: {
		text: (a: { detail: string }): string =>
			`rule broken, a kept render reads nothing its key leaves out: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e builds only (a rule ogygia checks on itself). A cached hole's render is kept
			for every later caller with the same key. One that read something per visitor (a flag,
			a cookie, a header, \`locals\`) for an anonymous visitor, or \`page.data\` with no page in
			its key, was kept anyway, so other visitors get this visitor's answer. An ogygia bug,
			please report it.
		`
	},
	rule_region_answer_shared: {
		text: (a: { detail: string }): string =>
			`rule broken, a region answer left without its privacy headers: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e builds only (a rule ogygia checks on itself). Every answer of the region
			endpoint carries \`Referrer-Policy: no-referrer\` (its URL is a capability, and must not
			reach another site in a Referer) and a \`Cache-Control\` that no shared cache keeps
			(\`no-store\`, or \`private\`). This one did not: something between the endpoint and the
			response (a plugin, a hook) changed its headers, or ogygia did. Please report it.
		`
	},
	rule_capability_not_path: {
		text: (a: { detail: string }): string =>
			`rule broken, a region capability was minted with more than a path: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e builds only (a rule ogygia checks on itself). A region capability URL is
			always a path on the page's own origin (\`/…\`), so the browser fetches it from the same
			server that signed it. This one had a scheme or host (often a \`paths.base\` set to a
			full URL). An ogygia bug, or a configuration ogygia should refuse: please report it.
		`
	}
};

type Server = MessagesOf<typeof SERVER_ERRORS, typeof SERVER_WARNINGS>;
// (the tables reach a dev build and the server's, worded in dev and while prerendering — a production
// server prints the link alone; a browser bundle that reaches this module through shared code drops
// them. `?.`: a plain Node import has no `import.meta.env`, it gets the link alone)
const server: Server = /* @__PURE__ */ define_messages(
	import.meta.env?.DEV || import.meta.env?.SSR ? SERVER_ERRORS : null,
	import.meta.env?.DEV || import.meta.env?.SSR ? SERVER_WARNINGS : null,
	dev_or_prerender
);
export const OgygiaError: Server['OgygiaError'] = server.OgygiaError;
export const warn: Server['warn'] = server.warn;
export const line: Server['line'] = server.line;
