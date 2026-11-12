import {
	define_messages,
	dev_or_prerender,
	prose,
	type MessagesOf
} from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`, or `console.error(new OgygiaError(…), err)` for a
 *  failure that is caught. */
export const CONTENT_ERRORS = {
	content_glob_illegal_id: {
		text: (a: { id: string; key: string }): string => `illegal id '${a.id}' for ${a.key}`,
		details: (): string => prose`
			\`glob()\` gave a file an id that is empty, contains \`..\`, or starts with \`/\`. An id
			becomes part of a URL, so it must be a plain relative path. Fix the \`id\` function, or
			rename the file.
		`
	},
	content_glob_duplicate_id: {
		text: (a: { id: string; key: string }): string => `duplicate id '${a.id}' (${a.key})`,
		details: (): string => prose`
			Two files of one \`glob()\` source got the same id, so one would hide the other. Rename
			one of them, or make the \`id\` function tell them apart.
		`
	},
	content_schema_failed: {
		text: (a: { label: string; issues: string }): string =>
			`schema failed for ${a.label}: ${a.issues}`,
		details: (): string => prose`
			An entry's data did not pass the collection's \`schema\`. \`label\` names the entry and
			\`issues\` lists what the schema rejected. Fix the entry's frontmatter or data, or loosen
			the schema.
		`
	},
	content_schema_unsupported: {
		text: (a: { label: string }): string =>
			`schema for ${a.label} is not Standard Schema / parse()-compatible`,
		details: (): string => prose`
			A collection's \`schema\` must be a Standard Schema (most validation libraries make one)
			or an object with a \`parse()\` method. This one is neither.
		`
	},
	content_format_not_object: {
		text: (a: { label: string; got: string }): string =>
			`${a.label}: expected a plain object (got ${a.got})`,
		details: (): string => prose`
			A content format expected an entry's data (its module, its metadata, its JSON) to be a
			plain object, and got \`got\` instead. Make the file export, or contain, an object.
		`
	},
	content_markdown_not_module: {
		text: (a: { id: string }): string => `markdown: ${a.id}: expected a module with metadata`,
		details: (): string => prose`
			A markdown source read a file that did not load as a module. The glob behind it matches
			files that are not compiled markdown: narrow it to the markdown extensions.
		`
	},
	content_markdown_no_metadata: {
		text: (a: { id: string }): string =>
			`markdown: ${a.id}: missing metadata (is markdown configured?)`,
		details: (): string => prose`
			A markdown file loaded, but without the \`metadata\` the markdown compiler adds. The
			markdown preprocessor is not running: pass \`markdown\` to \`content()\` in vite.config,
			and spread \`preprocess()\` into svelte.config.
		`
	},
	content_dated_format_invalid: {
		text: (a: { format: string }): string =>
			`dated(): format '${a.format}' must contain YYYY, MM and DD exactly once`,
		details: (): string => prose`
			\`dated()\` reads each entry's date from its name with \`format\`, so the format needs
			the year, the month and the day: \`YYYY\`, \`MM\` and \`DD\`, each exactly once (for
			example \`YYYY-MM-DD\`).
		`
	},
	content_folder_unexpected_file: {
		text: (a: { key: string; page: string; sidecar: string }): string =>
			`folder(): unexpected file '${a.key}' — expected a page (${a.page}) or sidecar (${a.sidecar || 'none'}). A '**/*' glob drags colocated components into the bundle; narrow it.`,
		details: (): string => prose`
			A \`folder()\` source's glob matched a file that is neither a page nor a sidecar (a
			\`+meta.json\`). Every file a glob matches is bundled, so a broad glob drags colocated
			components and assets in with the content. Narrow the glob to the page and sidecar
			files.
		`
	},
	content_folder_invalid: {
		text: (a: { issues: string }): string => `folder(): ${a.issues}`,
		details: (): string => prose`
			A \`folder()\` source checks its folders' \`NN-\` ordering prefixes when it is first
			read: siblings all prefixed or none, one padding width, no repeated number. \`issues\`
			names each folder that breaks it.

			Rename the folders, or opt one out with \`"ordered": false\` in its \`+meta.json\`.
		`
	},
	content_folder_empty_id: {
		text: (a: { key: string }): string => `folder(): empty id for '${a.key}'`,
		details: (): string => prose`
			A \`folder()\` page's path became an empty id once its ordering prefixes were stripped.
			Give the page a folder with a name.
		`
	},
	content_folder_duplicate_id: {
		text: (a: { id: string; key: string }): string =>
			`folder(): duplicate id '${a.id}' ('${a.key}')`,
		details: (): string => prose`
			Two pages of one \`folder()\` source got the same id once their ordering prefixes were
			stripped (\`01-intro\` and \`02-intro\` are both \`intro\`). Rename one of them.
		`
	},
	content_with_remotes_not_collection: {
		text: (): string => 'withRemotes() expects a collection from content()/collection()',
		details: (): string => prose`
			\`withRemotes()\` adds a collection's remote functions, so it takes what \`content()\`
			or \`collection()\` returned. It was given something else.
		`
	},
	content_streaming_prerender_list: {
		text: (): string =>
			'streaming `loader` cannot use prerender list — use live.list() or mode: "query"',
		details: (): string => prose`
			A collection whose \`loader\` streams changes cannot list its entries at prerender time:
			the list would freeze. Use \`live.list()\`, or pass \`mode: "query"\` to \`list()\`.
		`
	},
	content_loader_missing: {
		text: (): string => 'content() requires `loader`',
		details: (): string => prose`
			\`content()\` was called without a \`loader\`, the source its entries come from. Pass
			one: \`markdown()\`, \`json()\`, \`blocks()\`, \`folder()\` or \`glob()\`, or an
			\`import.meta.og.loader\` macro.
		`
	},
	content_loader_not_source: {
		text: (): string =>
			'`loader` must be a source ({ refs, get }) — use markdown()/json()/blocks()/folder()/glob()',
		details: (): string => prose`
			A collection's \`loader\` must be a source: an object with \`refs()\` and \`get()\`.
			Build one with \`markdown()\`, \`json()\`, \`blocks()\`, \`folder()\` or \`glob()\`, or
			write the two functions for a source of your own (a CMS, a database).
		`
	},
	content_ref_missing_id: {
		text: (): string => 'source ref missing string id',
		details: (): string => prose`
			A source's \`refs()\` returned an entry without a string \`id\`. Every entry needs one:
			it names the entry and becomes part of its URL.
		`
	},
	content_duplicate_id: {
		text: (a: { id: string }): string => `duplicate id '${a.id}'`,
		details: (): string => prose`
			A source's \`refs()\` returned two entries with the same \`id\`, so one would hide the
			other. Make the ids unique.
		`
	},
	content_live_source_failed: {
		text: (): string => 'live source failed:',
		details: (): string => prose`
			A collection's live source (a \`loader\` that streams changes) threw while it waited for
			the next change: its connection dropped. The error follows the message. The collection
			keeps what it last loaded, opens the connection again after a wait that doubles (up to a
			minute), and reads the whole source again then, so a change made meanwhile is not lost.
		`
	},
	content_site_context_failed: {
		text: (): string =>
			'site(): the `context` function threw; this request reads the public pages only:',
		details: (): string => prose`
			The \`context\` function passed to \`site()\` threw while it read a request. The site
			still answers, with the context empty: drafts, previews and anything else your
			\`filter\` opens through the context stay hidden for this request. The error follows
			the message. Fix \`context\` so it returns an object for every request (return \`{}\`
			when there is no session).
		`
	},
	content_live_change_failed: {
		text: (): string => 'a live change could not be applied:',
		details: (): string => prose`
			A change from a collection's live source could not be applied: an entry failed its
			schema, or reading it failed. The error follows the message. That entry keeps its last
			good version (a new entry stays out until it is valid); every other entry, and every
			change after this one, still applies.
		`
	},
	content_outline_weave_failed: {
		text: (): string =>
			'the outline could not be woven from changed content, so it keeps the last one:',
		details: (): string => prose`
			A live source changed a collection the site's outline arranges, and the outline could
			not be woven from the new content: an entry it places nowhere, a pick whose entry is
			gone, or two entries at one address. The error follows the message and names them. The
			nav, the pages and the addresses stay as last woven, and the outline weaves again at
			the next change. Fix the content, or the outline.
		`
	},
	content_search_index_fetch_failed: {
		text: (a: { url: string; status: number }): string =>
			`could not load the search index at ${a.url} (HTTP ${a.status}). Did you mount site.emit.search()?`,
		details: (): string => prose`
			The search box fetched its index and the server did not answer with it. The index is a
			route the app mounts with \`site.emit.search()\`, by convention at \`search.json\` under
			the site's base. Mount it there, or point the search box's \`endpoint\` at where it is.
		`
	},
	content_search_unavailable: {
		text: (): string => 'search index unavailable —',
		details: (): string => prose`
			The search palette could not load its index (the reason follows the message), so it
			answers nothing. The message before this one usually says why.
		`
	},
	content_search_query_failed: {
		text: (): string => 'a search query failed —',
		details: (): string => prose`
			The search palette asked its engine (the search worker, or the \`query\` function given to
			\`Search\`) for a term, and the engine failed (the error follows the message): a worker
			that crashed, a backend that is down. The palette shows the error in place of results.
			The next term typed asks again.
		`
	},
	content_search_engine_missing: {
		text: (): string =>
			'search needs the optional peer dependency "@orama/orama". Install it:\n' +
			'  npm i @orama/orama   (or the pnpm / yarn / bun equivalent)',
		details: (): string => prose`
			The docs site's default search engine is an optional peer dependency, so it is not
			installed with \`@ogygia/content\`. Install \`@orama/orama\` in the app, or give the
			site a search engine of its own.
		`
	},
	content_check_failed: {
		text: (a: { slug: string; file: string; count: number; findings: string }): string =>
			`check failure${Number(a.count) === 1 ? '' : 's'} on '${a.slug}'${a.file ? ` (${a.file})` : ''}:\n${a.findings}`,
		details: (): string => prose`
			A site check (\`links()\`, or a check of your own) found errors on a page while it was
			rendered or prerendered. \`findings\` lists each one with the check that found it and,
			when it knows, the line. Fix the page, or change that check's options.
		`
	},
	content_dimensions_no_axis: {
		text: (): string => 'dimensions() needs at least one axis.',
		details: (): string => prose`
			\`dimensions()\` splits a docs site along axes (a version, a framework). It was given
			none: add one under \`axes\`, or leave \`dimensions()\` out.
		`
	},
	content_axis_default_missing: {
		text: (a: { axis: string; value: string }): string =>
			`axis "${a.axis}": default "${a.value}" is not in values.`,
		details: (): string => prose`
			An axis of \`dimensions()\` names a \`default\` that is not one of its \`values\`. Add
			it to \`values\`, or pick one that is there.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const CONTENT_WARNINGS = {
	content_block_unregistered: {
		text: (a: { type: string }): string => prose`
			blocks: no block registered for type ${a.type} — skipped. Add it to your registry, or fix
			the type name.
		`,
		details: (): string => prose`
			Dev only. A block tree has a node whose \`type\` has no component in the registry, so the
			node and its children are left out. Add the type to the registry, or fix the type name
			in the data.
		`
	},
	content_links_no_data: {
		text: (a: { slug: string }): string => prose`
			links() check is on, but '${a.slug}' comes from a collection whose entries carry no
			'meta.links' (only markdown collects them). Link checking is a NO-OP for this corpus —
			fill 'meta.links' in the format to enable it.
		`,
		details: (): string => prose`
			Dev only. The \`links()\` check reads each page's links from its entry's
			\`meta.links\`, which only the markdown format collects. This page's collection has
			none, so its links are not checked. Fill \`meta.links\` in the collection's format to
			check them. Said once per collection.
		`
	},
	content_check_warned: {
		text: (a: { slug: string; file: string; count: number; findings: string }): string =>
			`check failure${Number(a.count) === 1 ? '' : 's'} on '${a.slug}'${a.file ? ` (${a.file})` : ''}:\n${a.findings}`,
		details: (): string => prose`
			A site check found problems on a page that it reports as warnings: the page still
			renders. \`findings\` lists each one with the check that found it and, when it knows,
			the line.
		`
	}
};

type Own = MessagesOf<typeof CONTENT_ERRORS, typeof CONTENT_WARNINGS>;
const own: Own = /* @__PURE__ */ define_messages(
	import.meta.env?.DEV || import.meta.env?.SSR ? CONTENT_ERRORS : null,
	import.meta.env?.DEV || import.meta.env?.SSR ? CONTENT_WARNINGS : null,
	dev_or_prerender
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. Wording and link in dev and while prerendering, the link alone otherwise. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
