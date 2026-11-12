import {
	define_messages,
	dev_or_prerender,
	prose,
	type MessagesOf
} from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`. */
export const POSTRENDER_ERRORS = {
	postrender_invalidate_not_source: {
		text: (): string => prose`
			postrender.invalidate(fn, args): the function is not a declared source — wrap its
			definition: \`export const fn = import.meta.og.source(async (…) => …)\`.
		`,
		details: (): string => prose`
			\`invalidate(fn, args)\` evicts the stored pages that read a data source with those
			arguments. It only knows the functions declared as sources: this one is not.

			Wrap the function's definition in \`import.meta.og.source(…)\`. Or evict by URL with
			\`invalidate(url)\`.
		`
	},
	postrender_adapter_request_failed: {
		text: (a: { what: string; status: number; body: string }): string =>
			`${a.what} failed: ${a.status} ${a.body}`,
		details: (): string => prose`
			A store or edge adapter called its service's HTTP API (to purge a URL, or to run a store
			command) and the service answered with an error status. \`status\` and \`body\` are its
			answer.

			A 401 or 403 is usually the adapter's credentials (a token, a key) or their permissions.
		`
	},
	postrender_store_client_missing: {
		text: (a: { client: string; commands: string }): string =>
			`${a.client} client has no ${a.commands} — og.source tags need it`,
		details: (): string => prose`
			The client handed to the store adapter has no set commands, which the adapter needs to
			file each stored page under the sources it read (\`import.meta.og.source\`). Pass a
			client that has them.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const POSTRENDER_WARNINGS = {
	postrender_edges_without_shared_store: {
		text: (): string => prose`
			postrender: edge adapters are configured but the store is the per-instance memory default
			— invalidations cannot reach other replicas. Use a shared store (ValkeyStore / UpstashStore /
			CloudflareKvStore) in multi-instance deploys.
		`,
		details: (): string => prose`
			\`postrender.handle()\` was given edge adapters but no \`store\`, so each server instance
			keeps its own memory store. An invalidation evicts the page on the instance that runs it
			and purges the edge, but the other instances keep their stale copy and serve it to the
			edge again.

			Give \`postrender.handle()\` a shared \`store\` when the app runs on more than one
			instance.
		`
	},
	postrender_store_no_evict_by_tag: {
		text: (): string => prose`
			postrender: the configured store has no evictByTag — tag invalidation needs it
			(MemoryStore/ValkeyStore/UpstashStore/CloudflareKvStore all provide it).
		`,
		details: (): string => prose`
			An invalidation by source or tag needs the store to evict every page filed under a tag,
			through \`evictByTag\`. The configured store has none, so nothing was evicted. Add
			\`evictByTag\` to the custom store, or use one of the built-in stores.
		`
	},
	postrender_tag_evict_failed: {
		text: (a: { tag: string }): string => prose`
			postrender.invalidate(tags): the store failed to evict tag ${a.tag} (evictByTag); its
			pages stay stored until they expire —
		`,
		details: (): string => prose`
			The store's \`evictByTag\` threw for one tag (the error follows the message). The other
			tags were still evicted and purged at the edges; this tag's pages stay stored until
			they expire.
		`
	},
	postrender_store_failed: {
		text: (a: { op: string; key: string }): string => prose`
			postrender: the store failed (${a.op} ${a.key}); pages render fresh and are not kept
			while it does —
		`,
		details: (): string => prose`
			A call to the store given to \`postrender.handle({ store })\` threw (the error follows the
			message). A store that is down never fails a render: a read is a miss, a write or an
			evict is skipped. So every page renders fresh, nothing is kept, and an evict may leave a
			page stored until it expires. Said once, then again only after a store call worked: a
			store that stays down does not fill the log.

			Check the store's connection and credentials.
		`
	},
	postrender_fanout_failed: {
		text: (a: { label: string; what: string }): string => `postrender.${a.label}: ${a.what} —`,
		details: (): string => prose`
			An invalidation reaches the store and every edge adapter at once. One of those calls
			failed (\`what\` names it; the error follows the message); the others still ran. The
			page may stay stored, or cached at that edge, until it expires.
		`
	},
	postrender_stays_per_request: {
		text: (a: { path: string; refusal: string }): string => prose`
			postrender: ${a.path} stays per-request — the render read ${a.refusal}. Personalize inside
			a render:'deferred' hole to make the shell storable.
		`,
		details: (): string => prose`
			Dev only. The page's render read something personal (a cookie, a header, the visitor) or
			answered in a way that cannot be shared (a status other than 200, a \`set-cookie\`
			header, streamed load promises), so it is rendered per request and never stored.
			\`refusal\` names what.

			Move the personal part into a \`render: 'deferred'\` hole: the rest of the page is then
			stored, and the hole fills in per visitor.
		`
	},
	postrender_handle_unlisted: {
		text: (): string => prose`
			postrender.handle() runs, but \`postrender()\` is not listed in vite.config, so no page is
			stored. Add it: \`plugins: [ogygia(), postrender(), sveltekit()]\`
			(from '@ogygia/postrender/vite').
		`,
		details: (): string => prose`
			\`postrender.handle()\` is in the hooks, but the plugin's server half never started, so
			nothing is ever stored.

			List \`postrender()\` (from \`@ogygia/postrender/vite\`) in the \`plugins\` of vite.config,
			beside \`ogygia()\`.
		`
	}
};

type Own = MessagesOf<typeof POSTRENDER_ERRORS, typeof POSTRENDER_WARNINGS>;
// @why plain Node has no `import.meta.env`, so it is read with `?.` (test: test/messages-node.test.ts › load under plain Node, which has no import.meta.env)
const own: Own = /* @__PURE__ */ define_messages(
	import.meta.env?.DEV || import.meta.env?.SSR ? POSTRENDER_ERRORS : null,
	import.meta.env?.DEV || import.meta.env?.SSR ? POSTRENDER_WARNINGS : null,
	dev_or_prerender
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. Wording and link in dev and while prerendering, the link alone otherwise. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
