import { f as fnv1a } from './hash.js-C-SlWFdQ.js';

// ../../../core/src/source.ts
/**
* DATA SOURCES — `import.meta.og.source(fn)`, the RUNTIME half (the compiler rewrites the macro to
* `__og_source('<file#export>', fn, opts?)`, injecting the import from `ogygia/internal`).
* Isomorphic + tiny: on the server, each call records a receipt tag (`s:<id>:<fingerprint(args)>`)
* — kept with the request's facts while its render may be stored (the invalidation reverse
* index), and shown to an observer (a federated fragment reporting what its render read);
* everywhere else it is a pure pass-through. `sourceTag(fn, args)` (the plugin door) reads the
* stamped id back off the function — one side, no strings, typos are type errors.
*
* The recorder and observer ride ONE `globalThis` slot: several module instances (dist entries,
* a plugin package beside core) must share the seam.
*/
var slots = globalThis[Symbol.for("ogygia.sources")] ??= {
	recorder: null,
	observer: null
};
/** hooks.ts installs this once — files a receipt with the current request's facts. */
function set_source_recorder(fn) {
	slots.recorder = fn;
}
/** Called by the `__og_source` wrapper on every invocation (and by a peer handle for the tags it
*  ADOPTS from a remote fragment). Neither seam may fail the app's own call. */
function record_source_read(tag) {
	try {
		slots.recorder?.(tag);
	} catch {}
	try {
		slots.observer?.(tag);
	} catch {}
}
/** The identity stamp — read by `freeze.invalidate(fn, args)`. */
var SOURCE_ID = Symbol.for("ogygia.freeze.source-id");
/** The optional `{ key }` canonicalizer stamp (exotic signatures). */
var SOURCE_KEY = Symbol.for("ogygia.freeze.source-key");
/** Canonicalize one argument: event-ish shapes collapse to their route identity (a whole
*  RequestEvent can never ride a fingerprint), URLs to pathnames, functions to a marker. */
function canonical(value, depth = 0) {
	if (value === null || typeof value !== "object") return typeof value === "function" ? "[fn]" : value;
	if (depth > 4) return "[deep]";
	if (value instanceof URL) return value.pathname;
	const v = value;
	if (v.url instanceof URL && ("request" in v || "cookies" in v)) return {
		__route: v.route?.id ?? null,
		__path: v.url.pathname
	};
	if (typeof Request !== "undefined" && value instanceof Request) return "[request]";
	if (Array.isArray(value)) return value.map((x) => canonical(x, depth + 1));
	const out = {};
	for (const key of Object.keys(v).sort()) out[key] = canonical(v[key], depth + 1);
	return out;
}
/** The structural fingerprint of a call's args — stable across processes and time. */
function fingerprint_args(args) {
	try {
		return fnv1a(JSON.stringify(canonical(args)));
	} catch {
		return "opaque";
	}
}
/** `s:<id>:<fp>` — the receipt/eviction tag for one (source, args) pair. */
function source_tag(id, fingerprint) {
	return `s:${id}:${fingerprint}`;
}
/** The compiled form of `export const X = import.meta.og.source(fn, opts?)`. */
function __og_source(id, fn, opts) {
	const wrapped = (...args) => {
		record_source_read(source_tag(id, fingerprint_args(args)));
		return fn(...args);
	};
	Object.defineProperty(wrapped, SOURCE_ID, { value: id });
	return wrapped;
}
/** The receipt tag one `(source, args)` call files, or null when `fn` is not a declared source. */
function source_tag_of(fn, args = []) {
	const id = fn[SOURCE_ID];
	if (!id) return null;
	const key_fn = fn[SOURCE_KEY];
	return source_tag(id, key_fn ? key_fn(...args) : fingerprint_args(args));
}

export { __og_source as _, set_source_recorder as a, source_tag_of as s };
//# sourceMappingURL=source.js-B4t88Kxi.js.map
