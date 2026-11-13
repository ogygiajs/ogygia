/**
 * EVERY MESSAGE CONTENT PRINTS AT BUILD TIME — the Vite plugin, the `import.meta.og` macros, the
 * markdown compiler, which run in Node (never in a page): its code, its wording, what to do about it
 * (core's `@ogygia/core/internal/messages` says how the system works).
 *
 *   throw new OgygiaError('content_git_spec_invalid', { spec });
 *   warn('content_collection_not_server_only', { file });
 *
 * The wording always prints, then the code's page. Collections, sources and the docs site have their
 * own (./runtime.ts).
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';
import { dedent } from '@ogygia/compiler';

/** The errors: `throw new OgygiaError(code, args)`. */
export const CONTENT_BUILD_ERRORS = {
	content_md_dynamic: {
		text: (): string => prose`
			import.meta.og.md(): the content compiled to something dynamic (a script, component tag,
			island import, or Svelte expression). md() is for static prose + fenced code — use a
			component for anything live.
		`,
		details: (): string => prose`
			\`import.meta.og.md()\` renders its markdown to static HTML at build time. This markdown
			compiled to something that has to run: a script, a component, an island, a Svelte
			expression. Keep \`md()\` to prose and fenced code, and use a component for the live
			part.
		`
	},
	content_frontmatter_tab_indent: {
		text: (): string => 'tabs are not allowed for indentation',
		details: (): string => prose`
			A frontmatter block indents a line with a tab. YAML indents with spaces only: replace
			the tabs with spaces.
		`
	},
	content_frontmatter_empty_key: {
		text: (a: { line: string }): string => `empty mapping key in line: ${a.line}`,
		details: (): string => prose`
			A frontmatter line has a colon with no key before it (\`: value\`). Give it a key, or
			quote the line as a string.
		`
	},
	content_frontmatter_invalid: {
		text: (a: { reason: string }): string => `invalid frontmatter YAML: ${a.reason}`,
		details: (): string => prose`
			A markdown file's frontmatter (the block between the \`---\` lines) is not valid YAML.
			\`reason\` says what the parser stopped at. Fix the block, or quote the value it names.
		`
	},
	content_highlight_unconfigured: {
		text: (): string =>
			'highlight() needs markdown() in svelte.config, or pass options as the third argument',
		details: (): string => prose`
			\`highlight()\` uses the code-highlighting settings the markdown config set up. None is
			set up in this process: configure markdown in svelte.config, or pass the highlighting
			options to \`highlight()\` as its third argument.
		`
	},
	content_mdsvex_missing: {
		text: (): string =>
			`Markdown content needs the optional peer dependency "mdsvex". Install it:\n  npm i -D mdsvex   (or the pnpm / yarn / bun equivalent)`,
		details: (): string => prose`
			Markdown is compiled with \`mdsvex\`, an optional peer dependency: it is not installed
			with \`@ogygia/content\`, so an app that uses markdown installs it.
		`
	},
	content_preset_unknown_variant: {
		text: (a: { preset: string; configured: string }): string =>
			`unknown content preset '${a.preset}' on a module variant. Configured: ${a.configured || '(none)'}.`,
		details: (): string => prose`
			A module was imported as a content preset's variant, and no preset of that name is
			configured. Use a name listed under \`content({ presets })\` in vite.config, or add the
			preset there.
		`
	},
	content_regions_key_collision: {
		text: (a: { glob: string; key: string; first: string; second: string }): string => prose`
			import.meta.og.regions('${a.glob}'): two files map to the block key '${a.key}'
			(${a.first} and ${a.second}). Rename one.
		`,
		details: (): string => prose`
			\`import.meta.og.regions()\` keys each matched component by its file name, and two files
			give the same key, so one would hide the other. Rename one of them.
		`
	},
	content_code_interpolated: {
		text: (a: { file: string; line: number; label: string }): string =>
			`${a.file}:${a.line} — import.meta.og.code(): ${a.label} is a template literal with \${…} interpolation, which the build can't resolve. Use a static string.`,
		details: (): string => prose`
			\`import.meta.og.code()\` and \`import.meta.og.md()\` are read at build time, so their
			text has to be in the source as it is. A template literal with an interpolation is only
			known when the code runs. Write the text as a plain string.
		`
	},
	content_code_not_static: {
		text: (a: { file: string; line: number; label: string }): string =>
			`${a.file}:${a.line} — import.meta.og.code(): ${a.label} must be a static string literal.`,
		details: (): string => prose`
			\`import.meta.og.code()\` and \`import.meta.og.md()\` are read at build time, so each
			argument has to be a string written in the source, not a variable or an expression.
		`
	},
	content_md_arity: {
		text: (a: { file: string; line: number }): string =>
			`${a.file}:${a.line} — import.meta.og.md(text) takes exactly one argument.`,
		details: (): string => prose`
			\`import.meta.og.md()\` takes one argument: the markdown, as a string written in the
			source.
		`
	},
	content_code_arity: {
		text: (a: { file: string; line: number }): string =>
			`${a.file}:${a.line} — import.meta.og.code(source, lang, meta?) takes 2 or 3 arguments.`,
		details: (): string => prose`
			\`import.meta.og.code()\` takes the source, its language, and optionally the fence's
			meta (\`title=…\`, line highlights), each a string written in the source.
		`
	},
	content_loader_options_unparsable: {
		text: (a: { context: string }): string =>
			`${a.context}: could not parse the options object while looking for \`preset\` — simplify the options, and keep \`preset\` a literal string.`,
		details: (): string => prose`
			A loader macro reads its \`preset\` option at build time, from the options as they are
			written. These options could not be parsed. Write them as a plain object literal.
		`
	},
	content_preset_not_literal: {
		text: (a: { context: string }): string =>
			`${a.context}: \`preset\` must be a literal string ('name') — it selects a content preset at build.`,
		details: (): string => prose`
			A loader macro's \`preset\` picks the markdown settings its files compile with, at build
			time, so it has to be a string written in the source, not a variable.
		`
	},
	content_preset_unknown: {
		text: (a: { context: string; preset: string; configured: string }): string =>
			`${a.context}: unknown content preset '${a.preset}'. ${
				a.configured
					? `Configured: ${a.configured}.`
					: 'No content presets are configured — define it under content({ presets }).'
			}`,
		details: (): string => prose`
			A loader macro names a \`preset\` that is not configured. Use a name listed under
			\`content({ presets })\` in vite.config, or add the preset there.
		`
	},
	content_loader_unknown: {
		text: (a: { method: string }): string =>
			`import.meta.og.loader.${a.method}() is not a loader — expected markdown, folder, json, or git.`,
		details: (): string => prose`
			\`import.meta.og.loader\` has four loaders: \`markdown\`, \`folder\`, \`json\` and
			\`git\`. For any other source, write it by hand (an object with \`refs()\` and
			\`get()\`).
		`
	},
	content_preset_unknown_query: {
		text: (a: { id: string; preset: string; configured: string }): string =>
			`'${a.id}': unknown content preset '${a.preset}' in the module query. Configured: ${a.configured}.`,
		details: (): string => prose`
			A module was imported with \`?og_preset=\` naming a preset that is not configured. Use a
			name listed under \`content({ presets })\` in vite.config.
		`
	},
	content_presets_need_markdown: {
		text: (): string =>
			'`presets` requires `markdown` — the defaults are the base every preset merges over (an empty `markdown: {}` is fine).',
		details: (): string => prose`
			Each content preset is merged over the default markdown settings, so \`content()\` needs
			\`markdown\` beside \`presets\`. An empty \`markdown: {}\` is enough.
		`
	},
	content_preset_name_invalid: {
		text: (a: { name: string }): string =>
			`presets: '${a.name}' — preset names are identifiers ([A-Za-z0-9_-]).`,
		details: (): string => prose`
			A preset's name travels in module queries, so it may only hold letters, digits, \`_\`
			and \`-\`. Rename the preset.
		`
	},
	content_config_read_first: {
		text: (): string =>
			'the svelte config read `extensions()` / `preprocess()` before `content({ markdown })` ran, so it compiles no markdown.',
		details: (): string => prose`
			The svelte config's \`extensions()\` and \`preprocess()\` read the markdown settings that
			\`content({ markdown })\` sets in the vite config. Something loaded the svelte config first
			(often an \`import\` of \`svelte.config.js\` at the top of \`vite.config\`), so it got
			\`.svelte\` alone and no markdown preprocessor. Load the svelte config after the plugin list
			is built, or let \`sveltekit()\` load it.
		`
	},
	content_preset_empty: {
		text: (a: { name: string }): string =>
			`presets.${a.name} is empty — a preset with nothing is a mistake.`,
		details: (): string => prose`
			A content preset sets nothing, so it would compile exactly like the defaults. Give it its
			\`markdown\` settings, or remove it.
		`
	},
	content_preset_unknown_key: {
		text: (a: { name: string; key: string }): string =>
			`presets.${a.name}: unknown key \`${a.key}\`. A content preset takes \`markdown\`.`,
		details: (): string => prose`
			A content preset holds one thing: its \`markdown\` settings. Move the other key into
			\`markdown\`, or remove it.
		`
	},
	content_git_spec_invalid: {
		text: (a: { spec: string }): string =>
			`import.meta.og.loader.git(): bad spec '${a.spec}' — expected 'owner/repo[@ref][:path]'`,
		details: (): string => prose`
			\`import.meta.og.loader.git()\` takes a repository as \`owner/repo\`, optionally with a
			ref (\`@main\`, a tag, a sha) and a folder inside it (\`:docs\`).
		`
	},
	content_git_cache_unavailable: {
		text: (a: { repo: string }): string =>
			`git(${a.repo}): the build cache (node_modules/.ogygia) is unavailable — cannot materialize a checkout.`,
		details: (): string => prose`
			A \`git()\` loader checks its repository out into the build cache,
			\`node_modules/.ogygia\`, and that cache is not available in this build. Run the build
			from the app's root, where \`node_modules\` can be written to.
		`
	},
	content_git_frozen_no_checkout: {
		text: (a: { repo: string }): string => prose`
			git(${a.repo}): frozen build, but no materialized checkout. Restore the node_modules/.ogygia
			cache, run a non-frozen build first, or pin a sha in the spec.
		`,
		details: (): string => prose`
			A frozen build does not fetch: it uses the checkout an earlier build left in
			\`node_modules/.ogygia\`, and there is none. Restore that cache (in CI, cache the folder
			between runs), run one build that is not frozen first, or pin a sha in the spec.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const CONTENT_BUILD_WARNINGS = {
	content_loader_in_component: {
		text: (a: { file: string }): string => prose`
			${a.file} calls import.meta.og.loader.* inside a component. Loaders build a content corpus
			and are server-only — move the collection to a \`.server.ts\` module and cross the wire
			with remotes. (In a component it never rewrites and fails at runtime.)
		`,
		details: (): string => prose`
			An \`import.meta.og.loader\` macro is in a component. Loaders are rewritten only in
			script modules, so in a component the call stays as it is and fails when it runs.

			Define the collection in a \`.server.ts\` module, and read it from components through
			its remote functions.
		`
	},
	content_collection_not_server_only: {
		text: (a: { file: string }): string => prose`
			${a.file} defines a collection outside a server-only module. Move it to a \`.server.ts\`
			file (or \`src/lib/server/\`) and mint remotes for the wire — Kit then guarantees the
			corpus can never reach a client bundle.
		`,
		details: (): string => prose`
			A \`content()\` collection is defined in a module the browser could import. One import
			from an island or a route component would bundle the whole corpus (often megabytes of
			compiled markdown) into the client, with no error. Said once per file.

			Move the collection to a \`.server.ts\` file or \`src/lib/server/\`, which Kit never
			lets client code import, and read it through its remote functions.
		`
	},
	content_leaked_to_client: {
		text: (a: { count: number; chunk: string; modules: string }): string => dedent`
			content leaked into the CLIENT bundle: ${a.count} corpus module(s) (.svx/.md) shipped to the browser (in chunk '${a.chunk}').
			  A content() collection was imported into client-shipped code — usually an island — which drags its eager import.meta.glob (every doc) in.
			  Fix: keep the collection in a server-only module (or a .remote.ts) and feed islands DATA (refs) via props or a remote, never the collection itself.
			${a.modules
				.split('\n')
				.map((m) => `    ${m}`)
				.join('\n')}${a.count > 5 ? '\n    …' : ''}
		`,
		details: (): string => prose`
			Documents of a content collection ended up in the browser bundle. A collection imports
			every document it holds, so importing it into an island ships all of them.

			Keep the collection in server-only code (a \`+page.server.ts\`, a \`.remote.ts\`) and
			pass islands the data they need, as props or from a remote function.
		`
	}
};

type Own = MessagesOf<typeof CONTENT_BUILD_ERRORS, typeof CONTENT_BUILD_WARNINGS>;
const own: Own = define_messages(CONTENT_BUILD_ERRORS, CONTENT_BUILD_WARNINGS);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
