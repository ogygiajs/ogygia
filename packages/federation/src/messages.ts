/**
 * EVERY MESSAGE THE FEDERATION PACKAGE PRINTS, in one place: its code, its wording, what to do about
 * it (core's `@ogygia/core/internal/messages` says how the system works).
 *
 *   throw new OgygiaError('federation_mount_no_peer', { via: 'resolver' });
 *   warn('federation_thaw_notice_failed', e);
 *
 * Federation runs in the app's server build, so the wording is only passed in dev: a production
 * build prints the code's page alone.
 */
import {
	define_messages,
	dev_or_prerender,
	prose,
	type MessagesOf
} from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`. */
export const FEDERATION_ERRORS = {
	federation_mount_no_peer: {
		text: (a: { via: string }): string =>
			`mount(): the ${a.via} must yield a peer (from federate({ peers })).`,
		details: (): string => prose`
			\`mount()\` was given a resolver function or a pick, and for this request it returned
			something that is not a peer. Return one of the peers \`federate({ peers })\` made, for
			every request the page serves.
		`
	},
	shared_state_not_plain: {
		text: (a: { name: string; reason: string }): string => prose`
			SharedState '${a.name}': values must be plain data (devalue-serializable — JSON, Date, Map,
			Set, BigInt, RegExp). Functions, class instances, and DOM nodes do not cross build
			boundaries — share facts, not live objects. (${a.reason})
		`,
		details: (): string => prose`
			Shared state crosses between builds as data, so its values must serialize. Share plain
			facts; keep live objects (functions, class instances, DOM nodes) on one side.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const FEDERATION_WARNINGS = {
	federation_open_without_keys: {
		text: (): string => prose`
			federate() exposes a table/widgets but no peer has a \`key\` — every inbound call would be
			UNAUTHENTICATED. Add each caller as a peer with its public \`key\`, or pass \`open: true\`
			to acknowledge an intentionally open endpoint (behind mTLS / a mesh).
		`,
		details: (): string => prose`
			\`federate()\` exposes pages or widgets to other apps, but none of its peers has a public
			\`key\`, so no inbound call can be checked: anyone could call the endpoint.

			Add each calling app as a peer with its public \`key\` (\`ogygia keys\` mints a pair). If
			the endpoint is meant to be open, because something in front of it (mTLS, a service
			mesh) already checks the caller, pass \`open: true\`.
		`
	},
	federation_audience_missing: {
		text: (a: { name: string }): string => prose`
			federate({ name: '${a.name}' }) has peers that may call in, but no \`audience\` and no
			\`ORIGIN\`, so every signed call to this app is refused. Set \`audience\` to the host this
			app answers on, or set \`ORIGIN\`.
		`,
		details: (): string => prose`
			A signed call names the app it was meant for, its audience, so a call made for one app
			cannot be sent to another that trusts the same key. To check that, this app has to know
			its own host. It is never taken from the request: a server that builds its URL from the
			\`Host\` header would let the caller pick it.

			Set \`audience\` in \`federate()\` to the host (or hosts) this app answers on, for example
			\`audience: 'cms.example.com'\`. Without it, the host of the \`ORIGIN\` environment
			variable is used (SvelteKit's Node adapter reads the same one). With neither, signed
			calls to this app get a 401.
		`
	},
	federation_peer_answer_invalid: {
		text: (a: { peer: string; url: string }): string => prose`
			The peer '${a.peer}' answered ${a.url} with something that is not its JSON document, so
			the hop failed: a static widget shows its boundary card, a page read is a 504.
		`,
		details: (): string => prose`
			A peer answers a fragment or widget request with a JSON document. This answer did not
			parse: something between the apps changed it (a proxy or CDN error page, a cut-off
			response), or the URL reached something that is not the peer's ogygia handle. Ask the URL
			yourself, signed as this app, and see what comes back.
		`
	},
	federation_deploy_thaw_undelivered: {
		text: (a: { peers: string; rounds: number }): string =>
			`federation: the deploy thaw never reached ${a.peers} (${a.rounds} tries), so it is given up`,
		details: (): string => prose`
			After a deploy, this app tells its peers to drop the pages they stored with its fragments,
			as their asset links now point at the build before. These peers refused the notice or
			never answered, every time it was sent, so their stored pages keep the old build until
			they expire. A peer usually refuses when it has no key for this app, or something in front
			of it blocks the request.
		`
	},
	federation_thaw_notice_failed: {
		text: (): string => 'federation: thaw notice to peers failed —',
		details: (): string => prose`
			After an invalidation, this app tells its peers which of their stored pages used the
			changed data, so they can drop them. Sending that notice failed (the error, or the peers
			that never took it after every retry, follows the message), so a peer may serve its
			stored copy until it expires. A peer usually refuses when it has no key for this app, or
			its store is down.
		`
	}
};

type Own = MessagesOf<typeof FEDERATION_ERRORS, typeof FEDERATION_WARNINGS>;
// (the tables reach a dev build and the server's — a prerender words them too; a production browser
// bundle drops them. `?.`: a plain Node import has no `import.meta.env`, it gets the link alone)
const own: Own = /* @__PURE__ */ define_messages(
	import.meta.env?.DEV || import.meta.env?.SSR ? FEDERATION_ERRORS : null,
	import.meta.env?.DEV || import.meta.env?.SSR ? FEDERATION_WARNINGS : null,
	dev_or_prerender
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. Wording and link in dev and while prerendering, the link alone otherwise. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
