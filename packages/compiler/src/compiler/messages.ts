/**
 * EVERY MESSAGE OGYGIA PRINTS AT BUILD TIME — the compiler and the Vite plugin, which run in Node
 * (never in a page, so there is no production build to keep the wording out of): their code, their
 * wording, what to do about them. Same calls as the runtime's (./core.ts):
 *
 *   throw new OgygiaError('some_code', { file });
 *   warn('some_code', { file });
 *
 * The wording always prints, then the code's page `https://ogygiajs.dev/e/<code>?<args>`.
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/contract';

const BUG = 'An ogygia bug: please report it with the file that shows it.';

/** Retired `ogygia({ … })` keys, each with its new spelling: the config check throws
 *  `option_retired` for any of them (a legacy key that silently did nothing would un-tune real
 *  apps). */
export const RETIRED_OPTIONS: Record<string, string> = {
	regions:
		'`regions` is gone — its keys sit at the root now: write `visible`, `presets`, `ttl` and `maxPageAge` directly in `ogygia({ … })`.',
	continuity:
		'`continuity` is gone — form continuity rides the router. Write `router: { forms: false }` to disable it.',
	regionTtl: '`regionTtl` is `ttl` now — write `ogygia({ ttl: … })`.',
	preload:
		'`preload` is gone — there is nothing to choose any more. The page carries each island’s chunk list as data, and the runtime preloads an island’s whole graph when it wakes (after the page has painted), so no island code moves before its wake and none waits on a waterfall after it. Remove the key.',
	plugins:
		'`plugins` is gone — ogygia plugins are Vite plugins: list them beside `ogygia()` in vite.config, `plugins: [ogygia(), flags(), sveltekit()]`.',
	freeze:
		'`freeze` is a plugin now, named postrender — install `@ogygia/postrender` and list `postrender({ ttl, default })` (from `@ogygia/postrender/vite`) beside `ogygia()` in vite.config `plugins`.',
	content:
		'`content` is a plugin now — install `@ogygia/content` and list `content({ markdown, presets })` (from `@ogygia/content/vite`) beside `ogygia()` in vite.config `plugins`; the svelte config takes `preprocess()` / `extensions()` from there too.',
	devtools:
		"`devtools` is a plugin now — install `@ogygia/devtools` and list `devtools()` (from `@ogygia/devtools/vite`) beside `ogygia()` in vite.config `plugins`; only where you want it, e.g. `...(mode !== 'production' ? [devtools()] : [])`.",
	profiler:
		'`profiler` is part of the devtools plugin now — install `@ogygia/devtools` and list `devtools({ profiler: { … } })` (from `@ogygia/devtools/vite`) beside `ogygia()` in vite.config `plugins`.'
};

/** The errors: `throw new OgygiaError(code, args)`. */
export const BUILD_ERRORS = {
	// ── the import.meta.og macros ─────────────────────────────────────────────────────────────────
	macro_store_misuse: {
		text: (a: { file: string; line: number; problem: string }): string => prose`
			${a.file}:${a.line} — ${a.problem}. import.meta.og.store is legal in exactly one shape: a
			direct call wrapping a store factory — import.meta.og.store((seed) => ({ subscribe, … })).
			It registers the factory under a build tag so islands rebuild the store THROUGH it (custom
			methods survive); the factory's first parameter is the seed value.
		`,
		details: (): string => prose`
			\`import.meta.og.store\` is a compile-time mark, not a value: it only works as a direct
			call around a store factory, \`import.meta.og.store((seed) => writable(seed))\`. The
			build registers that factory so an island rebuilds the store through it, custom methods
			and all.

			\`problem\` names what was written instead (no argument, two arguments, a bare
			reference). Wrap the factory itself in one call.
		`
	},
	macro_dollar_misuse: {
		text: (a: { file: string; line: number; problem: string }): string => prose`
			${a.file}:${a.line} — ${a.problem}. import.meta.og.$ is legal in exactly one shape: a
			direct call wrapping an inline function — import.meta.og.$((args) => { … }). It hoists
			that function so its VALUE can cross an island boundary as a handle.
		`,
		details: (): string => prose`
			\`import.meta.og.$\` hoists a function into its own module so a handle to it can cross an
			island boundary. The build has to see the function itself, so the mark only works as a
			direct call around an inline function: \`import.meta.og.$((args) => ...)\`.

			\`problem\` names what was written instead. Pass the function inline, as the one argument.
		`
	},
	macro_wire_misuse: {
		text: (a: { file: string; line: number; problem: string }): string => prose`
			${a.file}:${a.line} — ${a.problem}. import.meta.og.wire is legal in exactly one position:
			\`static wire = import.meta.og.wire({ encode, decode })\` inside a class body. The macro
			consumes that member and mints the symbol key; the construct is not a value.
		`,
		details: (): string => prose`
			\`import.meta.og.wire\` makes a class transportable across an island boundary. The build
			replaces the member that holds it, so it only works in one place: a static member of a
			class, \`static wire = import.meta.og.wire(codec)\`, where the codec has \`encode\` and
			\`decode\`.

			\`problem\` names what was written instead. Move the call into that member.
		`
	},
	wire_class_anonymous: {
		text: (a: { file: string; line: number }): string => prose`
			${a.file}:${a.line} — an anonymous \`export default class\` has a wire codec. Give the
			class a name (\`export default class Cart\`) so the build can register it.
		`,
		details: (): string => prose`
			A class with a wire codec is registered while its module compiles: the build appends a
			call that hands the class to ogygia, tagged by its module and export name. An anonymous
			\`export default class { … }\` has no binding that call can name, so its instances could
			not cross into an island. Name the class; the export stays the default one.
		`
	},
	macro_source_misuse: {
		text: (a: { file: string; line: number; problem: string }): string => prose`
			${a.file}:${a.line} — ${a.problem}. import.meta.og.source is legal in exactly one
			position: \`export const <name> = import.meta.og.source(fn)\` (optionally
			\`(fn, { key })\`) at module top level. The compiler stamps the source id from that
			export's identity.
		`,
		details: (): string => prose`
			\`import.meta.og.source\` declares a data source. Its id is the file and export name it is
			declared under, so the build only accepts it as the initializer of a top-level
			\`export const\`: \`export const loadThing = import.meta.og.source(fn)\`.

			\`problem\` names what was written instead. Declare the source as its own exported
			constant.
		`
	},
	macro_outside_app: {
		text: (a: { file: string; macro: string }): string =>
			`${a.file} — import.meta.og.${a.macro}() is used in an installed package that does not declare this file in "ogygia.files".`,
		details: (): string => prose`
			The \`import.meta.og.*\` macros (\`bake\` runs code at build time) work in the app's own
			source, and in the files a package lists under \`"ogygia.files"\` in its package.json.
			An installed file outside that list that uses one fails the build, and nothing in it
			runs. If the package is meant to ship ogygia code, add the file (or a glob for it) to
			that package's \`"ogygia.files"\`; otherwise it should not use the macro.
		`
	},
	macro_needs_plugin: {
		text: (a: { file: string; macro: string; package: string; plugin: string }): string =>
			`${a.file} — import.meta.og.${a.macro}() needs the \`${a.plugin}\` plugin from \`${a.package}\`, listed beside ogygia().`,
		details: (): string => prose`
			This \`import.meta.og.*\` macro is compiled by a plugin, and that plugin is not in the
			app's Vite plugins. Without it the call would reach the browser or the server as is, and
			fail there. Install the package and list its plugin beside \`ogygia()\` in vite.config
			\`plugins\` (before \`sveltekit()\`).
		`
	},
	macro_bake_arity: {
		text: (a: { file: string; line: number }): string =>
			`${a.file}:${a.line} — import.meta.og.bake(fn) takes exactly one argument (a function).`,
		details: (): string => prose`
			\`import.meta.og.bake\` runs one function at build time and inlines its result. It takes
			that function and nothing else: \`import.meta.og.bake(() => buildNav())\`.
		`
	},
	macro_bake_not_function: {
		text: (a: { file: string; line: number }): string =>
			`${a.file}:${a.line} — import.meta.og.bake(fn): the argument must be a function (\`() => …\`).`,
		details: (): string => prose`
			\`import.meta.og.bake\` was given something other than an inline function (a variable, a
			value). The build evaluates the function's own source, so write it inline:
			\`import.meta.og.bake(() => buildNav())\`.
		`
	},
	macro_bake_eval_failed: {
		text: (a: { file: string; reason: string }): string => prose`
			import.meta.og.bake() in ${a.file}: evaluating the function failed — ${a.reason}. A baked
			function may use this module's IMPORTS and literals only (not its other local variables),
			and must not touch runtime-only modules ($app/*, the browser).
		`,
		details: (): string => prose`
			The build bundled the baked function with the module's imports and ran it, and it threw.
			\`reason\` is the error.

			The function runs alone, at build time: it sees the module's imports and literals, not its
			other local variables, and there is no request, no \`$app/*\` module and no browser. Move
			what it needs into an import.
		`
	},
	macro_bake_not_serializable: {
		text: (a: { file: string; line: number; reason: string }): string => prose`
			${a.file}:${a.line} — import.meta.og.bake(): the result is not serializable (${a.reason}).
			bake produces DATA — return plain values (JSON + Date/Map/Set/RegExp/BigInt), never a
			function, Promise, or class instance.
		`,
		details: (): string => prose`
			The baked function ran, but its result cannot be written into the module as a constant.
			\`reason\` names the value that failed.

			Return plain data: JSON values, \`Date\`, \`Map\`, \`Set\`, \`RegExp\`, \`BigInt\`. A
			function, a promise or a class instance cannot be baked.
		`
	},

	// ── the compiler ──────────────────────────────────────────────────────────────────────────────
	kit_config_not_literal: {
		text: (a: { file: string; key: string }): string =>
			`${a.file}: \`config.${a.key}\` must be a literal (true, false, a number, a string or null) — ogygia reads it at build time.`,
		details: (): string => prose`
			ogygia reads some keys of a route's \`export const config\` while it builds, from the
			source. This one is an expression (a variable, a call), which only has a value when the
			app runs. Write the value itself: \`true\`, \`false\`, a number, a string or \`null\`.
		`
	},
	island_import_unresolved: {
		text: (a: { specifier: string; host: string }): string => prose`
			cannot resolve '${a.specifier}' imported by the generated island module for ${a.host}.
			That island was marked on a package import, so the specifier must resolve from the host
			file: check the package is installed and its "exports" map exposes this subpath (with a
			"svelte" condition for .svelte components).
		`,
		details: (): string => prose`
			An island was marked on an import from a package, and the module ogygia generates for it
			imports that same specifier. It does not resolve from the file that marked it.

			Check the package is installed in the app, and that its \`exports\` map lists this
			subpath, with a \`svelte\` condition for a \`.svelte\` component.
		`
	},
	call_arg_not_literal: {
		text: (a: { call: string; got: string }): string =>
			`${a.call}: the first argument must be a static string literal, got '${a.got}…'`,
		details: (): string => prose`
			The build reads this call's first argument from the source, so it has to be a plain
			string, written out. \`got\` is what was written instead (a variable, a call). Put the
			string itself there.
		`
	},
	call_arg_interpolated: {
		text: (a: { call: string }): string => prose`
			${a.call}: the first argument must be a static string literal — a template literal with
			\${…} interpolation is a runtime value the build cannot resolve.
		`,
		details: (): string => prose`
			The build reads this call's first argument from the source. A template literal with a
			value inside it only has its text when the app runs. Write one plain string.
		`
	},
	call_arg_in_expression: {
		text: (a: { call: string; near: string }): string => prose`
			${a.call}: the first argument must be a static string literal, but it is part of a larger
			expression (near '${a.near}…'). Use one plain string.
		`,
		details: (): string => prose`
			The build reads this call's first argument from the source. Here the string is joined
			with something else (\`'./' + dir\`, a \`.concat()\` call), which only has its value when
			the app runs. Write the whole string out.
		`
	},

	// ── region imports (the host transform) ───────────────────────────────────────────────────────
	import_key_invalid: {
		text: (a: { role: string; got: string }): string =>
			`importKeys.${a.role} must be a non-empty JS identifier (got ${a.got}).`,
		details: (): string => prose`
			\`importKeys\` renames the import attributes ogygia reads (\`wake\`, \`fetch\`,
			\`render\`, \`preset\`, \`region\`). Each name is written as a key inside \`with\`, so it
			has to be a JavaScript identifier.
		`
	},
	import_keys_not_distinct: {
		text: (): string =>
			'importKeys.wake, importKeys.fetch, importKeys.render, importKeys.preset, and importKeys.region must be distinct.',
		details: (): string => prose`
			Two of the attribute names in \`importKeys\` are the same, so the build could not tell
			which one an import means. Give each its own name.
		`
	},
	region_value_not_raw: {
		text: (a: { host: string; key: string }): string => prose`
			${a.host}: \`${a.key}\` only takes the value 'raw' (a held region with no baked
			schedule). To bake a schedule use a \`wake:\` mark, or set it at the \`region()\` call.
		`,
		details: (): string => prose`
			The \`region\` import attribute marks a held region and has one value, \`'raw'\`. It
			carries no schedule. To give the region one, mark the import with \`wake\` instead, or
			pass \`wake\` where it is placed: \`region(C, props, opts)\`.
		`
	},
	wake_strategy_unknown: {
		text: (a: { host: string; key: string; value: string }): string =>
			`${a.host}: unknown \`${a.key}\` strategy '${a.value}'. Use 'load' | 'idle' | 'visible' | 'interaction' | a media query.`,
		details: (): string => prose`
			A \`wake\` mark says when an island's JavaScript runs. It takes \`'load'\`, \`'idle'\`,
			\`'visible'\`, \`'interaction'\` or a media query such as \`'(min-width: 800px)'\`.
		`
	},
	generated_module_relative_import: {
		text: (a: { host: string; specifier: string }): string => prose`
			${a.host}: cannot resolve the relative import '${a.specifier}' from a generated module —
			it has no directory. Its real origin must be threaded (HostCtx.originOf); this is an
			ogygia bug, please report it.
		`,
		details: (): string => BUG
	},
	region_import_invalid: {
		text: (a: { host: string; names: string; problem: string }): string =>
			`${a.host}: import { ${a.names} } — ${a.problem}`,
		details: (): string => prose`
			A marked import (one with \`wake\`, \`render\`, \`fetch\`, \`preset\` or \`region\` in
			its \`with\` clause) is written in a way the build cannot turn into a region. \`problem\`
			says what is wrong and what to write.
		`
	},
	as_region_invalid: {
		text: (a: { host: string; name: string; problem: string }): string =>
			`${a.host}: import.meta.og.asRegion (${a.name}) — ${a.problem}`,
		details: (): string => prose`
			\`import.meta.og.asRegion\` marks a component as a region, like a marked import. It only
			works on a plain \`const Name = import.meta.og.asRegion(Component, options)\`, with the
			same options an import's \`with\` clause takes. \`problem\` says what is wrong.
		`
	},
	region_children_not_portable: {
		text: (a: { host: string; tag: string; server: boolean }): string => prose`
			${a.host}: <${a.tag}> has host children/snippets that cannot cross the island boundary.
			Under portable bindings, pass serializable props and put UI inside the island
			component${a.server ? ' (only the reserved `{#snippet ogygiaFallback()}` may appear at the call site).' : '.'}
		`,
		details: (): string => prose`
			A deferred region or a held region renders on its own, from its props alone, so markup
			written between its tags has nowhere to go. Pass the data as props and put the markup
			inside the component.

			A deferred region may keep one snippet at the call site: \`ogygiaFallback\`, what shows
			until its HTML arrives.
		`
	},
	region_dotted_tag: {
		text: (a: { host: string; tag: string; import: string }): string => prose`
			${a.host}: dotted tag \`<${a.tag}>\` is not supported for region import '${a.import}'.
			Import the leaf component with \`with { hydrate|defer }\` instead.
		`,
		details: (): string => prose`
			A marked import becomes one region, so the build cannot reach a component hanging off it
			(\`Menu.Item\`). Import that component on its own and mark that import.
		`
	},
	dynamic_region_import: {
		text: (a: {
			host: string;
			keys: string;
			wake_key: string;
			render_key: string;
			preset_key: string;
		}): string => prose`
			${a.host}: dynamic import() with { with: { ${a.keys} } } is not supported. Mark islands
			with a static \`import X from '…' with { ${a.wake_key}: '…' }\` (or \`${a.render_key}\` /
			\`${a.preset_key}\`) — the binding becomes a portable island component. For a
			click-loaded chunk that is not an island, use plain \`await import('./Comp.svelte')\` (no
			region attributes) inside a host island. To delay a real island until click, gate a static
			region import with \`{#if}\`.
		`,
		details: (): string => prose`
			A region needs a static import and a tag the server can render, so region attributes on
			a dynamic \`import()\` do nothing (Vite drops them). Use a static marked import.

			To load a plain component on click, call \`await import('./Comp.svelte')\` with no region
			attributes, inside an island. To delay an island, put its tag behind an \`if\` block.
		`
	},
	region_import_no_specifier: {
		text: (a: { host: string; name: string; held: boolean }): string =>
			`${a.host}: ${a.held ? 'held-region import' : 'region import'} '${a.name}' needs a module specifier ($lib/…, relative, or a package specifier like 'pkg/component').`,
		details: (): string => prose`
			A marked import has no module path the build can resolve. Import the component from
			\`$lib/...\`, a relative path, or a package subpath such as \`'pkg/component'\`.
		`
	},
	snippet_reads_dollar_props: {
		text: (a: { host: string; snippet: string; name: string }): string => prose`
			${a.host}: {#snippet ${a.snippet}} crosses an island boundary but reads \`${a.name}\` —
			the host's $$-props cannot cross. Read the value into a plain host variable outside the
			snippet and use that instead.
		`,
		details: (): string => prose`
			A snippet passed into an island is rendered from the values it captures. \`$$props\` and
			\`$$restProps\` belong to the host component and cannot be captured. Read what the
			snippet needs into a plain variable in the host, outside the snippet, and use that.
		`
	},
	held_fetch_without_render: {
		text: (a: {
			host: string;
			fetch_key: string;
			render_key: string;
			wake_key: string;
			value: string;
		}): string => prose`
			${a.host}: \`${a.fetch_key}: '${a.value}'\` without \`${a.render_key}: 'deferred'\` —
			\`${a.fetch_key}\` is a hole's timing. Write \`${a.render_key}: 'deferred',
			${a.fetch_key}: '${a.value}'\` for a hole, or \`${a.wake_key}: '${a.value}'\` for an
			island.
		`,
		details: (): string => prose`
			\`fetch\` says when a deferred region's (a hole's) HTML arrives, so it only goes with
			\`render: 'deferred'\`. For a hole, write both. For an island that runs its JavaScript
			at that time, write \`wake\` instead.
		`
	},
	held_render_live: {
		text: (a: { host: string; render_key: string }): string =>
			`${a.host}: \`${a.render_key}: 'live'\` is not supported on a .ts import — use it in a .svelte file.`,
		details: (): string => prose`
			A live region is placed by a Svelte component. A \`.ts\` or \`.js\` module can only hand
			out held regions and holes, so mark the import in a \`.svelte\` file.
		`
	},
	held_render_unknown: {
		text: (a: { host: string; render_key: string; value: string }): string =>
			`${a.host}: unknown \`${a.render_key}\` '${a.value}'. Use 'deferred'.`,
		details: (): string => prose`
			In a \`.ts\` or \`.js\` module, \`render\` takes one value, \`'deferred'\`: a hole whose
			HTML is fetched from the server.
		`
	},
	held_hole_timed_twice: {
		text: (a: {
			host: string;
			render_key: string;
			fetch_key: string;
			wake_key: string;
			fetch: string;
			wake: string;
		}): string => prose`
			${a.host}: a \`${a.render_key}: 'deferred'\` hole timed twice, with \`${a.fetch_key}:
			'${a.fetch}'\` and \`${a.wake_key}: '${a.wake}'\`. Keep \`${a.fetch_key}\`: it says when a
			hole's HTML arrives.
		`,
		details: (): string => prose`
			A hole has one timing, \`fetch\`. The old spelling, \`wake\` on a hole, is still read,
			but with both the build cannot tell which one is meant. Remove \`wake\`.
		`
	},
	held_fetch_not_timing: {
		text: (a: { host: string; fetch_key: string; value: string }): string => prose`
			${a.host}: \`${a.fetch_key}: '${a.value}'\` is not a timing. Use \`${a.fetch_key}: 'load'
			| 'idle' | 'visible' | 'interaction'\` or a media query (a hole must fetch — not 'none').
		`,
		details: (): string => prose`
			\`fetch\` says when a hole's HTML arrives: \`'load'\`, \`'idle'\`, \`'visible'\`,
			\`'interaction'\` or a media query. A hole always fetches, so \`'none'\` is not one.
		`
	},
	held_marker_mixed: {
		text: (a: {
			host: string;
			name: string;
			region_key: string;
			wake_key: string;
			render_key: string;
			fetch_key: string;
		}): string => prose`
			${a.host}: a held-region import on '${a.name}' takes ONE marker — \`${a.region_key}:
			'raw'\`, \`${a.wake_key}: '…'\`, or \`${a.render_key}: 'deferred'\` (with
			\`${a.fetch_key}\` as its timing).
		`,
		details: (): string => prose`
			An import in a \`.ts\` or \`.js\` module is one kind of held region: \`region: 'raw'\`
			(no schedule), \`wake\` (an island) or \`render: 'deferred'\` (a hole, timed by
			\`fetch\`). Keep the one you mean.
		`
	},

	// ── the Vite plugin: options ──────────────────────────────────────────────────────────────────
	option_retired: {
		text: (a: { option: string }): string =>
			RETIRED_OPTIONS[a.option] ?? `\`${a.option}\` is gone.`,
		details: (): string => prose`
			An \`ogygia()\` option from an earlier version was passed. It is refused rather than
			ignored, so nothing silently stops working. The message says what replaced it.
		`
	},
	barrels_option_removed: {
		text: (): string => prose`
			\`ogygia({ barrels })\` is gone: the barrel rewrite is a plugin now. Install
			\`@ogygia/barrels\` and list \`barrels({ … })\` (from \`@ogygia/barrels\`) beside
			\`ogygia()\` in vite.config \`plugins\`, \`plugins: [ogygia(), barrels(), sveltekit()]\`.
		`,
		details: (): string => prose`
			The \`barrels\` option of \`ogygia()\` was passed. The pass that turns barrel imports into
			leaf imports moved to its own plugin, \`barrels()\` from \`@ogygia/barrels\`, which takes
			the same options. The standalone \`debarrel()\` from \`ogygia/vite\` is gone with it.

			Remove the option and list \`barrels()\` beside \`ogygia()\` in vite.config
			\`plugins\`.
		`
	},
	preset_empty: {
		text: (a: { name: string }): string =>
			`presets.${a.name} is empty — a preset with nothing is a mistake.`,
		details: (): string => prose`
			A region preset names a set of import options (\`with { preset: 'card' }\`). This one sets
			none. Give it its options, or remove it.
		`
	},
	preset_key_unknown: {
		text: (a: { name: string; key: string; allowed: string }): string =>
			`presets.${a.name}: unknown key \`${a.key}\`. A preset takes ${a.allowed}.`,
		details: (): string => prose`
			A region preset holds the options a marked import takes. \`key\` is not one of them;
			\`allowed\` lists those that are.
		`
	},
	max_page_age_invalid: {
		text: (a: { value: string }): string => prose`
			maxPageAge must be a number of seconds ≥ 0 (got ${a.value}). Write e.g. \`30 * 24 *
			3600\` for 30 days, or \`0\` to turn renewal off.
		`,
		details: (): string => prose`
			\`maxPageAge\` is how long, in seconds, a page's expired region addresses may still be
			renewed. Write a number, such as \`30 * 24 * 3600\` for 30 days, or \`0\` to never renew.
		`
	},
	secret_in_client_chunk: {
		text: (a: { file: string; what: string }): string => prose`
			the client build's ${a.file} holds ${a.what}. Browsers must never be able to sign region
			addresses: the build stops.
		`,
		details: (): string => prose`
			The secret that signs region addresses, or a server module that signs with it, ended up in
			a file the browser downloads. Usually a universal or client module imports a server-only
			module, or reads \`OGYGIA_SECRET\` and puts it in its output. Find the import that brings it
			into the client and move that code to a server-only file (\`+page.server.ts\`,
			\`hooks.server.ts\`, \`$lib/server\`).
		`
	},
	secret_too_short: {
		text: (a: { min_bytes: number }): string =>
			`OGYGIA_SECRET is too short for production builds (need ≥${a.min_bytes} UTF-8 bytes).`,
		details: (): string => prose`
			\`OGYGIA_SECRET\` signs region addresses. A short key can be guessed, so a production
			build refuses it (dev accepts any). Use a long random value, such as the output of
			\`openssl rand -base64 32\`.
		`
	},
	kit_remote_src_missing: {
		text: (): string =>
			"could not locate Kit's client remote-functions (src). Use an @sveltejs/kit that publishes its `src/` (2.70.2 or later, or 3.x).",
		details: (): string => prose`
			ogygia reuses SvelteKit's own client code for remote functions, from the \`src/\` folder
			Kit publishes. This version of \`@sveltejs/kit\` does not ship it. Upgrade to 2.70.2 or
			later.
		`
	},
	package_files_not_array: {
		text: (a: { package: string; got: string }): string => prose`
			${a.package}: \`"ogygia": { "files": […] }\` must be an array of package-relative
			paths/globs (like npm's "files") — got ${a.got}.
		`,
		details: (): string => prose`
			A package puts its files on ogygia's compile surface with \`ogygia.files\` in its
			\`package.json\`: a list of paths or globs inside the package, like npm's \`files\`.
			This one is not a list of strings.
		`
	},
	package_files_escapes: {
		text: (a: { package: string; entry: string }): string =>
			`${a.package}: ogygia.files entry '${a.entry}' escapes the package.`,
		details: (): string => prose`
			An \`ogygia.files\` entry points outside its own package (\`../\`, or a symlink in the
			package that leads out of it), which would compile code the package does not own. List
			paths inside the package only.
		`
	},

	// ── the Vite plugin: ogygia plugins ───────────────────────────────────────────────────────────
	plugin_without_ogygia: {
		text: (a: { plugin: string }): string =>
			`\`${a.plugin}\` is listed in vite.config but \`ogygia()\` is not — add \`ogygia()\` from \`ogygia/vite\` to \`plugins\`.`,
		details: (): string => prose`
			An ogygia plugin runs inside \`ogygia()\`, so it does nothing alone. Import \`ogygia\`
			from \`ogygia/vite\` and list \`ogygia()\` first in \`plugins\`.
		`
	},
	plugin_factory_not_called: {
		text: (): string =>
			'a function is listed in vite.config `plugins` — call the factory: `flags()`, not `flags`.',
		details: (): string => prose`
			A plugin is listed by its factory's name without calling it. Add the parentheses:
			\`flags()\`, not \`flags\`.
		`
	},
	plugin_after_sveltekit: {
		text: (a: { plugin: string }): string =>
			`\`${a.plugin}\` is listed after \`sveltekit()\` in vite.config — list \`ogygia()\` and its plugins first: \`plugins: [ogygia(), flags(), sveltekit()]\`.`,
		details: (): string => prose`
			Vite runs plugins in the order they are listed. ogygia and its plugins must see each
			module before SvelteKit does, so list them first:
			\`plugins: [ogygia(), flags(), sveltekit()]\`.
		`
	},
	plugin_name_missing: {
		text: (): string => 'a plugin definition needs a `name` (its package name).',
		details: (): string => prose`
			\`definePlugin()\` was called without a \`name\`. The name is the plugin's package name:
			ogygia resolves the package by it.
		`
	},
	plugin_listed_twice: {
		text: (a: { plugin: string }): string => `plugin \`${a.plugin}\` is listed twice.`,
		details: (): string =>
			'The same ogygia plugin appears twice in `plugins`. List it once, with all its options.'
	},
	plugin_realm_not_location: {
		text: (a: { plugin: string; realm: string }): string =>
			`plugin \`${a.plugin}\`: \`${a.realm}\` is a module location — \`import.meta.resolve('./${a.realm}.ts')\`.`,
		details: (): string => prose`
			A plugin's \`server\` and \`client\` name the module that runs there, as a location, not
			the module itself. Resolve it next to the factory:
			\`server: import.meta.resolve('./server.ts')\`.
		`
	},
	plugin_options_not_json: {
		text: (a: { plugin: string }): string =>
			`plugin \`${a.plugin}\`: \`options\` must be plain JSON (configure live objects in hooks.server.ts).`,
		details: (): string => prose`
			A plugin's \`options\` are written into the server build, so they must survive
			\`JSON.stringify\`. Set up live objects (clients, functions) in \`hooks.server.ts\`
			instead.
		`
	},
	plugin_realm_not_file: {
		text: (a: { plugin: string; realm: string; location: string }): string =>
			`plugin \`${a.plugin}\`: its \`${a.realm}\` realm \`${a.location}\` is not a file — resolve it next to the factory: \`import.meta.resolve('./${a.realm}.ts')\`.`,
		details: (): string => prose`
			A plugin's \`server\` or \`client\` location does not point at a file. Resolve it next to
			the factory, so it is the file the package ships:
			\`import.meta.resolve('./server.ts')\`.
		`
	},
	plugin_client_hooks_unread: {
		text: (a: { plugin: string; location: string }): string =>
			`plugin \`${a.plugin}\`: the build cannot read the \`hooks\` its client realm \`${a.location}\` subscribes to — write them as an object literal in \`export default defineClient({ hooks: { … } })\`.`,
		details: (): string => prose`
			The build reads which runtime hooks a plugin's browser half subscribes to from its
			file, so a hook nobody uses folds out of the runtime. That needs the default export to
			be \`defineClient({ … })\` (any part of it may sit in a module-level \`const\`), with \`hooks\` an object literal of
			plain keys: no spread, no computed key.
		`
	},
	plugin_client_hook_unknown: {
		text: (a: { plugin: string; hook: string }): string =>
			`plugin \`${a.plugin}\`: its client realm subscribes to \`${a.hook}\`, which is not a runtime hook.`,
		details: (): string => prose`
			A client realm's \`hooks\` keys must name runtime hooks (\`RuntimeHooks\` from
			\`ogygia/plugin/client\`). A misspelled one would never be called.
		`
	},
	plugin_package_unresolved: {
		text: (a: { plugin: string; root: string }): string =>
			`plugin \`${a.plugin}\`: no package by that name resolves from ${a.root} — its name must be its package name.`,
		details: (): string => prose`
			A plugin's \`name\` is its package name, and ogygia resolves the package by it from the
			app. Nothing by that name is installed there: install the package, or fix the name.
		`
	},
	route_config_key_invalid: {
		text: (a: { plugin: string; key: string }): string =>
			`plugin \`${a.plugin}\`: route config key \`${a.key}\` must be a camelCase identifier.`,
		details: (): string => prose`
			A plugin claimed a key of a route's \`export const config\` that is not a camelCase name.
			Use one such as \`postrender\`.
		`
	},
	route_config_key_claimed: {
		text: (a: { key: string; owner: string; plugin: string }): string =>
			`route config key \`${a.key}\` is claimed by both \`${a.owner}\` and \`${a.plugin}\`.`,
		details: (): string => prose`
			Two plugins claimed the same key of a route's \`export const config\`, so a route could
			not say which one it configures. One of them has to use another key.
		`
	},
	plugin_macro_name_invalid: {
		text: (a: { plugin: string; name: string }): string =>
			`plugin \`${a.plugin}\`: macro \`import.meta.og.${a.name}\` must be a camelCase name core does not own.`,
		details: (): string => prose`
			A plugin's macro is a camelCase name under \`import.meta.og\`. The names \`wire\`,
			\`$\`, \`source\`, \`store\` and \`bake\` are ogygia's own.
		`
	},
	plugin_macro_claimed: {
		text: (a: { name: string; owner: string; plugin: string }): string =>
			`macro \`import.meta.og.${a.name}\` is claimed by both \`${a.owner}\` and \`${a.plugin}\`.`,
		details: (): string => prose`
			Two plugins registered the same \`import.meta.og\` macro. One of them has to use another
			name.
		`
	},
	page_modules_not_absolute: {
		text: (a: { plugin: string; file: string }): string =>
			`plugin \`${a.plugin}\`: \`pageModules({ files })\` takes absolute paths (got \`${a.file}\`).`,
		details: (): string => prose`
			\`pageModules\` was given a relative file path. Pass absolute paths, for example
			resolved from the app's root.
		`
	},
	virtual_unknown: {
		text: (a: { id: string }): string => `\`${a.id}\` is not a module ogygia serves.`,
		details: (): string => prose`
			An import names a module in ogygia's namespace (\`ogygia:…\`) that no part of ogygia
			declares. Check the spelling against the modules the realm offers. If a plugin should
			serve it, check that the plugin is listed beside \`ogygia()\` in vite.config.
		`
	},
	virtual_wrong_realm: {
		text: (a: { id: string; realm: string; leg: string }): string =>
			`\`${a.id}\` is a ${a.realm} module, and the ${a.leg} build imported it.`,
		details: (): string => prose`
			Each of ogygia's modules runs in one realm: \`ogygia:server\` on the server, \`ogygia:boot\`
			in the browser's runtime, \`ogygia:region\` in both, \`ogygia:dev\` on the dev server only.
			A server module in the browser could carry a secret into the page. Read the value on the
			server and hand the browser what it needs through props or seeds.
		`
	},
	virtual_duplicate: {
		text: (a: { id: string }): string => `\`${a.id}\` is declared twice.`,
		details: (): string => prose`
			Two declarations claim the same virtual module. Each module is declared once, by the part
			of ogygia (or the plugin) that knows its value. ${BUG}
		`
	},
	virtual_names_stale: {
		text: (a: { id: string }): string =>
			`\`${a.id}\` exports other names than the ones generated for it.`,
		details: (): string => prose`
			A value module's export names are read off its declaration when ogygia is built, so its
			realm module knows them without running it. This one now returns other names: the
			generated list is stale. Run \`node packages/core/scripts/virtual-types.ts\`. ${BUG}
		`
	},
	plugin_session_order: {
		text: (a: { hook: string; state: string }): string =>
			`The bundler called ogygia's \`${a.hook}\` hook while the plugin was ${a.state}.`,
		details: (): string => prose`
			An \`ogygia()\` plugin is made, configured (\`config\`), then resolved
			(\`configResolved\`) once: its compiler is made from the resolved build. A hook that
			needs the compiler runs after that, and the build is resolved only once per plugin. A
			bundler or a tool that calls the hooks in another order meets this. ${BUG}
		`
	},
	build_leg_unclear: {
		text: (a: { leg: string; open: number }): string =>
			a.leg
				? `The bundler called ogygia in environment \`${a.leg}\`, which never started a build.`
				: `The bundler called ogygia with no environment while ${a.open} environments build.`,
		details: (): string => prose`
			Each bundler environment (\`ssr\`, \`client\`) builds its own output, and ogygia keeps what
			each one emits apart. A call it cannot place in one environment would put one
			environment's files in the other's output. ${BUG}
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`; and, at its end, the build's reports, which print
 *  their `line(code, args)` at info level. */
export const BUILD_WARNINGS = {
	macro_store_returns_non_store: {
		text: (a: { file: string; line: number }): string => prose`
			${a.file}:${a.line} — this import.meta.og.store factory has a return that is provably not
			a store (undefined/null/primitive). Where that branch runs, the product crosses as plain
			data, unbranded. If it is an environment guard, return a store there too (e.g.
			writable(seed)) and guard the side effects inside the factory instead.
		`,
		details: (): string => prose`
			A store factory marked with \`import.meta.og.store\` returns something that is not a
			store on one branch (\`undefined\`, \`null\`, a number). Where that branch runs, the
			value reaches islands as plain data, not as the store.

			If the branch guards an environment (the server), return a store there too, such as
			\`writable(seed)\`, and guard the side effects inside the factory.
		`
	},
	scoped_css_failed: {
		text: (a: { file: string; reason: string }): string =>
			`scoped CSS for ${a.file} could not be compiled (${a.reason}) — shipping its style bodies unscoped`,
		details: (): string => prose`
			ogygia compiles a component's styles on their own to ship them with its HTML, and that
			compile failed (\`reason\`). The styles ship without Svelte's scoping, so its rules can
			reach the rest of the page. Fix the component so it compiles.
		`
	},
	package_marks_undeclared: {
		text: (a: { file: string }): string => prose`
			${a.file} uses ogygia marks, but its package declares no \`"ogygia": { "files": [...] }\`
			— the marks are IGNORED. Add the field to that package's package.json
			(npm-"files"-style paths/globs) to put it on ogygia's compile surface.
		`,
		details: (): string => prose`
			A file in a dependency marks imports for ogygia (\`with { wake }\`), but ogygia only
			compiles a package's files when the package asks for it. So the marks do nothing.

			Add \`ogygia.files\` to that package's \`package.json\`: the paths or globs ogygia
			compiles, like npm's \`files\`.
		`
	},
	runtime_marks_late: {
		text: (a: { file: string; features: string }): string => prose`
			${a.file} placed a region that needs the runtime's ${a.features}, but the build had already
			made its runtime without it: that region will not work in this build. Put the file where
			the scan reads it: under \`src/\`, or in a package that declares \`"ogygia": { "files":
			[...] }\`.
		`,
		details: (): string => prose`
			A build picks the runtime's features once, from the regions it knows when the bundler
			loads the runtime entry. This file was first reached later, while bundling, and one of
			its regions needs a feature (a lake, a \`keep\`, a held region, a deferred hole, a wake
			on interaction) the runtime was made without. The region then never wakes or never
			fills.

			ogygia reads every file under \`src/\` and every declared package file before the
			bundler starts. Move the file there, or declare it in its package's \`ogygia.files\`.
		`
	},
	relocation_unpatched: {
		text: (a: { name: string; leg: string }): string => prose`
			the ${a.name} in the ${a.leg} build was left unpatched: a value the build fills in at the end
			never reached its chunk, so that part of the output is wrong. Please report it.
		`,
		details: (): string => prose`
			Some values are known only once the bundler has transformed every module: the \`og.$\`
			functions an app defines, and which server regions read \`page.data\`. The build writes a
			placeholder for each and fills it in as each chunk is finished. A placeholder was left in
			the output, or the module that carries it is in the output and none was filled. This is
			an ogygia bug, or another plugin rewrote the chunk after ogygia filled it.
		`
	},
	island_context_unprovided: {
		text: (a: { file: string; key: string }): string => prose`
			island code ${a.file} reads getContext('${a.key}'), but this app registers no ogygia
			context provider and no island code sets '${a.key}'. On a csr=false page a value set with
			Svelte's setContext in a page/layout does NOT cross the island boundary — the island reads
			undefined on the client, re-renders a different tree, and Svelte discards its
			server-rendered DOM on hydration (a silent full re-render). Fix: provide '${a.key}' with
			setContext / <Provide> / createContext imported from 'ogygia' (in a csr=false layout); the
			read stays getContext('${a.key}').
		`,
		details: (): string => prose`
			An island reads a context nothing in the browser provides. On a csr=false page a layout
			or page runs only on the server, so a value it sets with Svelte's \`setContext\` never
			reaches the island there. The island renders a different tree and Svelte throws its
			server HTML away.

			Provide the value with \`setContext\`, \`<Provide>\` or \`createContext\` imported from
			\`ogygia\`. The island keeps reading it with \`getContext\`.
		`
	},
	region_host_skipped: {
		text: (a: { file: string; reason: string; at: string }): string =>
			`regions: skipped ${a.file}: ${a.reason}${a.at ? ` at ${a.at}` : ''} — its region imports stay plain imports`,
		details: (): string => prose`
			ogygia could not parse the component, so its marked imports were left as plain imports:
			no island, no hole. The Svelte compiler reports the parse error itself. Fix it and the
			regions come back.
		`
	},
	hole_wake_deprecated: {
		text: (a: {
			host: string;
			said?: string;
			render_key: string;
			wake_key: string;
			fetch_key: string;
			value: string;
		}): string => prose`
			${a.host}: ${
				a.said
					? `${a.said} times a \`${a.render_key}: 'deferred'\` hole with`
					: `a \`${a.render_key}: 'deferred'\` hole timed with`
			} \`${a.wake_key}: '${a.value}'\`, which is deprecated. Write \`${a.render_key}:
			'deferred', ${a.fetch_key}: '${a.value}'\` instead: \`${a.fetch_key}\` says when a hole's
			HTML arrives. (\`${a.wake_key}\` is when an island's JS runs; a hole ships no JS.)
		`,
		details: (): string => prose`
			A deferred region (a hole) is timed with \`wake\`. \`wake\` is when an island's
			JavaScript runs, and a hole ships none: its timing is \`fetch\`, when its HTML arrives.
			The old spelling still works for now. Write \`render: 'deferred', fetch: 'visible'\`.
		`
	},
	snippet_store_snapshot: {
		text: (a: { host: string; snippet: string; store: string; at: string }): string => prose`
			${a.host}: {#snippet ${a.snippet}} crosses an island boundary and reads \`${a.store}\`
			(at ${a.at}) — captured as a FROZEN snapshot of the store's value at render time; later
			store updates never reach the island. To make the snapshot explicit (and silence this),
			read it at host scope outside the snippet — e.g. \`const ${a.store.slice(1)}_value =
			${a.store};\` — and use that.
		`,
		details: (): string => prose`
			A snippet passed into an island reads a store with \`$\`. In plain Svelte that value is
			live. Across an island boundary the snippet is rendered once from the values it captured,
			so the island keeps the value the store had at render time.

			To say so in the code (and silence this), read the value into a host variable outside
			the snippet and use that. For a value that keeps changing, share a wired class instead.
		`
	},
	snippet_store_unverified: {
		text: (a: { host: string; snippet: string; store: string; at: string }): string => prose`
			${a.host}: {#snippet ${a.snippet}} reads \`${a.store}\` (at ${a.at}), but
			\`${a.store.slice(1)}\` is not a host declaration or import, so ogygia cannot verify it
			is a store. Its value is captured at the host anyway — if the build now errors in
			${a.host}, start there.
		`,
		details: (): string => prose`
			A snippet passed into an island reads \`$name\`, but \`name\` is not declared or imported
			in the host, so ogygia cannot tell it is a store. It captures the value at the host as if
			it were. If the build then fails in that file, this is the place to look.
		`
	},
	snippet_captures_store: {
		text: (a: { host: string; snippet: string; store: string }): string => prose`
			${a.host}: {#snippet ${a.snippet}} crosses an island boundary and captures the store
			\`${a.store}\` as an OBJECT — a host-declared store cannot cross (its functions don't
			serialize). Use its value (\`$${a.store}\`) inside the snippet, or share live state with a
			wired class instead.
		`,
		details: (): string => prose`
			A snippet passed into an island uses a store declared in the host as an object. The
			snippet's captures are serialized, and a store's functions cannot be. Read its value
			with \`$\` inside the snippet, or share live state with a wired class.
		`
	},
	sass_missing: {
		text: (): string =>
			'a server-rendered component has `<style lang="scss">` but neither `sass-embedded` nor `sass` is installed — its hole/router CSS ships unprocessed',
		details: (): string => prose`
			ogygia compiles the styles of components it serves itself (holes, router pages). One is
			written in SCSS and no Sass compiler is installed, so its CSS ships as written. Install
			\`sass-embedded\` or \`sass\`.
		`
	},
	scss_compile_failed: {
		text: (a: { file: string; reason: string }): string =>
			`${a.file}: scss compile failed — ${a.reason}`,
		details: (): string => prose`
			A component's SCSS did not compile (\`reason\`), so its style block ships as written.
			Fix the stylesheet.
		`
	},
	ts_strip_failed: {
		text: (a: { file: string; reason: string }): string =>
			`${a.file}: TypeScript strip failed — ${a.reason}`,
		details: (): string => prose`
			ogygia strips the types from a component's TypeScript script to compile its styles, and
			that failed (\`reason\`). The component's CSS may then ship unscoped. Fix the script.
		`
	},
	optimize_deps_includes_ogygia: {
		text: (a: { specifiers: string; count: number }): string => prose`
			optimizeDeps.include lists ${a.specifiers}: ogygia must not be pre-bundled in dev (the
			page would run two copies of its runtime, and islands with snippet props fail to
			hydrate). Remove ${a.count === 1 ? 'it' : 'them'}.
		`,
		details: (): string => prose`
			Vite's \`optimizeDeps.include\` lists part of ogygia. ogygia keeps itself out of Vite's
			dependency pre-bundling, and listing it brings a second copy of its runtime into the dev
			page. Remove those entries.
		`
	},
	island_handoff_write_failed: {
		text: (): string => 'could not write the server-leg island handoff:',
		details: (): string => prose`
			The server build writes which components it transformed, so the client build emits only
			the islands those pages place. Writing it failed (the error follows the message). The
			build goes on and emits every island it found.
		`
	},
	package_files_missing: {
		text: (a: { package: string; entry: string }): string =>
			`${a.package}: ogygia.files entry '${a.entry}' does not exist — skipped.`,
		details: (): string => prose`
			An \`ogygia.files\` entry in a dependency's \`package.json\` names a path that is not in
			the package. It is skipped. The package should fix or remove the entry.
		`
	},
	kit_config_unreadable: {
		text: (a: { file: string; routes: string; out: string; reason: string }): string =>
			`could not read ${a.file} for kit.files.routes / kit.outDir — using the defaults (${a.routes}, ${a.out}). ${a.reason}`,
		details: (): string => prose`
			ogygia loads \`svelte.config.js\` to find the routes folder and Kit's output folder, and
			loading it threw (the reason follows). It uses Kit's defaults. If the app moved either
			folder, fix the config so it loads.
		`
	},

	// ── the build's reports: printed at info level with `line(code, args)`, never warned ──────────
	island_chunks_not_emitted: {
		text: (a: { count: number }): string =>
			`${a.count} island chunk(s) not emitted: their host modules are not in the server bundle (unreachable from this build's routes).`,
		details: (): string => prose`
			The client build found islands whose host components no route of this build renders, so
			it left their chunks out. Nothing is wrong unless an island is missing from a page that
			should have it: then check the route that renders its host is part of the build.
		`
	},
	flags_manifest_written: {
		text: (a: { count: number }): string =>
			`flags manifest: ${a.count} flag(s) → node_modules/.ogygia/flags-manifest.json`,
		details: (): string => prose`
			The build wrote the inventory of every \`flag()\` it found, with where each is read, to
			\`node_modules/.ogygia/flags-manifest.json\`. Tools (the devtools, a flag dashboard) read it
			from there.
		`
	},
	page_seed_report: {
		text: (a: { islands: number; pinned: number; keys: number; unpinned: number }): string =>
			`page seed: ${a.islands} island${a.islands === 1 ? '' : 's'} read page.data — ${a.pinned} pinned to ${a.keys} key${a.keys === 1 ? '' : 's'}, ${a.unpinned} ship all of it`,
		details: (): string => prose`
			An island that reads \`page.data\` gets a copy of it in the page. When the build can see
			which keys it reads, the island is pinned to them and only those ship. When it cannot (the
			whole object is spread, passed on, or read with a computed key), the island ships all of
			\`page.data\`.

			The lines below the report name the modules that made an island ship everything, with
			the reason. Read the keys you need by name there, and the copy shrinks.
		`
	}
};

type Build = MessagesOf<typeof BUILD_ERRORS, typeof BUILD_WARNINGS>;
const build: Build = define_messages(BUILD_ERRORS, BUILD_WARNINGS);
export const OgygiaError: Build['OgygiaError'] = build.OgygiaError;
export const warn: Build['warn'] = build.warn;
/** A code's line as a string, for a logger that takes one (Rollup's `this.warn`). */
export const line: Build['line'] = build.line;
