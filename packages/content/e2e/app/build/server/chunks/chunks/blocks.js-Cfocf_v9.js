import { r as region } from './Region.js-DspBOxVI.js';

// ../../src/source.ts
var BACKSLASH = /\\/g;
var filePathOf = (key) => key.replace(BACKSLASH, "/").split("?")[0];
/** Strip ONE trailing extension, whatever it is — no hardcoded format list. */
var stripExt = (p) => p.replace(/\.[^./\\]+$/, "");
/**
* Default id for a glob: drop the directory prefix shared by all keys, then the file extension.
* `../content/docs/00-start/install.svx` (in a set rooted at `.../docs/`) → `00-start/install`.
* Override entirely with `glob(map, { id })` when you want different ids (e.g. strip `NN-` prefixes).
*/
function defaultGlobIds(keys) {
	const norm = keys.map((k) => k.replace(BACKSLASH, "/").split("?")[0]);
	let prefix = norm[0] ? norm[0].slice(0, norm[0].lastIndexOf("/") + 1) : "";
	for (const p of norm.slice(1)) while (prefix && !p.startsWith(prefix)) prefix = prefix.slice(0, prefix.slice(0, -1).lastIndexOf("/") + 1);
	const out = /* @__PURE__ */ new Map();
	keys.forEach((key, i) => {
		const rel = stripExt(norm[i].slice(prefix.length));
		out.set(key, rel || stripExt(norm[i]));
	});
	return out;
}
/** True for a value that already implements the raw-source contract (refs/get functions). */
function isRawSource(v) {
	return !!v && typeof v.refs === "function" && typeof v.get === "function";
}
/**
* Wrap an `import.meta.glob(...)` map as a raw source: ids are the (prefix-stripped, extension-less)
* keys, `get(id)` loads ONE module, `refs()` loads all. Lazy globs load a module only when read — so
* `get(id)` on a big local collection touches one file, not the whole set.
*/
function glob(globMap, opts = {}) {
	const keys = Object.keys(globMap).sort();
	const defaults = opts.id ? null : defaultGlobIds(keys);
	const idFor = (key) => opts.id ? opts.id(key) : defaults.get(key) ?? key;
	const byId = /* @__PURE__ */ new Map();
	for (const key of keys) {
		const id = idFor(key);
		if (!id || id.includes("..") || id.startsWith("/")) throw new Error(`[ogygia/content] illegal id '${id}' for ${key}`);
		if (byId.has(id)) throw new Error(`[ogygia/content] duplicate id '${id}' (${key})`);
		byId.set(id, key);
	}
	const load = async (key) => {
		const v = globMap[key];
		return typeof v === "function" ? await v() : v;
	};
	const record = async (id, key) => ({
		id,
		value: await load(key),
		filePath: filePathOf(key)
	});
	return {
		async get(id) {
			const key = byId.get(id);
			return key ? record(id, key) : null;
		},
		refs: () => Promise.all([...byId].map(([id, key]) => record(id, key)))
	};
}
/** Compose a raw source + a format into a finished {@link Source}. Threads `init`/`live`/`groups`. */
function defineSource(raw, format, extra) {
	const ref = async (r) => {
		const parts = await format(r.value, r.id);
		return {
			id: r.id,
			data: parts.data,
			...parts.meta !== void 0 ? { meta: parts.meta } : {},
			...r.order !== void 0 ? { order: r.order } : {},
			...r.filePath ? { filePath: r.filePath } : {}
		};
	};
	const full = async (r) => {
		const parts = await format(r.value, r.id);
		return {
			id: r.id,
			data: parts.data,
			...parts.meta !== void 0 ? { meta: parts.meta } : {},
			...r.order !== void 0 ? { order: r.order } : {},
			...r.filePath ? { filePath: r.filePath } : {},
			...parts.body !== void 0 ? { body: parts.body } : {},
			...parts.source !== void 0 ? { source: parts.source } : {}
		};
	};
	const inits = [raw.init, extra?.init].filter(Boolean);
	const groups = extra?.groups ?? raw.groups;
	return {
		...inits.length ? { init: async () => void await Promise.all(inits.map((f) => f())) } : {},
		refs: async (q) => Promise.all((await raw.refs(q)).map(ref)),
		async get(id) {
			const r = await raw.get(id);
			return r ? full(r) : null;
		},
		...raw.live ? { live: raw.live } : {},
		...groups ? { groups } : {}
	};
}
/** Turn a source builder's input (a glob map, or a raw source you wrote) into a raw source. */
function toRawSource(input, opts = {}) {
	return isRawSource(input) ? input : glob(input, opts);
}
// ../../src/blocks.ts
/**
* Turn a raw block tree into a tree of regions, ONCE. `type` → `region(registry[type], props, schedule)`
* recursively, so downstream (`<Blocks>`, a collection body) never touches the registry. Shared by
* `<Blocks>` (resolves per render) and `blocks()` (resolves at mint). An unregistered `type` is skipped
* with a dev warning rather than guessed at.
*/
function resolve_block_tree(tree, registry, schedule) {
	const nodes = Array.isArray(tree) ? tree : tree ? [tree] : [];
	const out = [];
	for (const node of nodes) {
		const binding = registry?.[node?.type];
		if (!binding) continue;
		out.push({
			of: region(binding, node.props ?? {}, schedule),
			children: node.children && node.children.length ? resolve_block_tree(node.children, registry, schedule) : void 0
		});
	}
	return out;
}
/** If Vite wrapped a lone JSON `default` export, unwrap it. */
function unwrap_default(resolved) {
	if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) return resolved;
	const mod = resolved;
	if (!("default" in mod)) return resolved;
	const keys = Object.keys(mod).filter((k) => k !== "__esModule");
	if (keys.length === 1 && keys[0] === "default") return mod.default;
	return resolved;
}
/** Pull the block tree + frontmatter data out of the source's several accepted shapes. */
function normalize(value) {
	if (Array.isArray(value)) return {
		tree: value,
		data: {}
	};
	if (value && typeof value === "object") {
		const o = value;
		if (Array.isArray(o.blocks)) return {
			tree: o.blocks,
			data: o.meta ?? o.data ?? {}
		};
		if (typeof o.type === "string") return {
			tree: [o],
			data: {}
		};
	}
	return {
		tree: [],
		data: {}
	};
}
/**
* Build a `blocks` source. The registry is resolved into regions AT MINT (`blocks.resolve`), so an
* entry's `body` is a clean tree of regions — the registry never rides along. `data` carries any `meta`
* frontmatter the page declared. The body renders through an internal recomposer, the same one the
* no-collection recipe reproduces in ten lines.
*/
function blocks(input, registry, opts = {}) {
	let Blocks;
	const format = (resolved) => {
		const { tree, data } = normalize(unwrap_default(resolved));
		const nodes = resolve_block_tree(tree, registry, opts.schedule);
		return {
			data,
			body: region(Blocks, { nodes })
		};
	};
	return defineSource(toRawSource(input, opts), format, { init: async () => {
		Blocks = (await import('./Blocks2.js-DDf-xIzl.js')).default;
	} });
}
/**
* `blocks.resolve(tree, registry, schedule?)` — the helper for the no-collection recipe: turn a tree
* you hold into region nodes (`type → region`, recursively, unknown types skipped). MUST run server-
* side (a `+page.server.ts` load, a remote, or a `csr = false` SSR pass), where the signing key lives.
* Render the result with your own small recomposer. Same walk the `blocks()` source runs at mint.
*/
blocks.resolve = resolve_block_tree;

export { blocks as b, defineSource as d, resolve_block_tree as r, toRawSource as t };
//# sourceMappingURL=blocks.js-Cfocf_v9.js.map
