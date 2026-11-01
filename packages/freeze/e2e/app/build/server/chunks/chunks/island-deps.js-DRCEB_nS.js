import fs__default from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// \0virtual:ogygia/island-deps
var __OG_INLINE = "{\"js\":{\"/_app/immutable/og-region.66b250ec993f.js\":[\"/_app/immutable/chunks/BoaGctkA.js\",\"/_app/immutable/chunks/C3DqmHOU.js\",\"/_app/immutable/chunks/C82MoFHZ.js\",\"/_app/immutable/chunks/h7YPRWw_.js\",\"/_app/immutable/chunks/6zCZ8NgT.js\",\"/_app/immutable/chunks/B095bM6r.js\",\"/_app/immutable/chunks/CRzLMJPS.js\",\"/_app/immutable/chunks/DV9O-X0T.js\",\"/_app/immutable/chunks/KyuKv9Uk.js\"],\"/_app/immutable/og-region.95906992795f.js\":[\"/_app/immutable/chunks/6zCZ8NgT.js\",\"/_app/immutable/chunks/C3DqmHOU.js\"],\"/_app/immutable/og-runtime.381f90123eb5-f03d70b1.js\":[\"/_app/immutable/chunks/DlShpR8w.js\",\"/_app/immutable/chunks/DZqhIq-T.js\",\"/_app/immutable/chunks/CRzLMJPS.js\"]},\"css\":{\"/_app/immutable/og-region.66b250ec993f.js\":[],\"/_app/immutable/og-region.95906992795f.js\":[]},\"page\":{\"/_app/immutable/og-region.66b250ec993f.js\":false,\"/_app/immutable/og-region.95906992795f.js\":false},\"page_keys\":{},\"remotes\":{\"/_app/immutable/og-region.66b250ec993f.js\":[],\"/_app/immutable/og-region.95906992795f.js\":[]},\"interactivity\":{\"/_app/immutable/og-region.66b250ec993f.js\":{\"handlers\":0,\"state\":0,\"effects\":0,\"binds\":0,\"actions\":0,\"awaits\":0,\"shared\":0,\"files\":1,\"remotes\":0},\"/_app/immutable/og-region.95906992795f.js\":{\"handlers\":1,\"state\":1,\"effects\":0,\"binds\":0,\"actions\":0,\"awaits\":0,\"shared\":0,\"files\":1,\"remotes\":0}},\"hazards\":{},\"contents\":{},\"heavy\":{},\"dupes\":[],\"content_css\":{},\"css_inline\":{},\"fn_manifest\":{},\"entries\":{\"/_app/immutable/og-region.66b250ec993f.js\":\"/_app/immutable/og-region.66b250ec993f.5_A71gi6.js\",\"/_app/immutable/og-region.95906992795f.js\":\"/_app/immutable/og-region.95906992795f.CnFWdRr0.js\",\"/_app/immutable/og-runtime.381f90123eb5-f03d70b1.js\":\"/_app/immutable/og-runtime-f03d70b1.DFk45R4q.js\"}}";
var cache = null;
try {
	if (__OG_INLINE.charCodeAt(0) === 123) cache = JSON.parse(__OG_INLINE);
} catch {}
function candidates() {
	const out = [];
	try {
		let dir = path.dirname(fileURLToPath(import.meta.url));
		for (let i = 0; i < 8; i++) {
			out.push(path.join(dir, "og-region-deps.json"));
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	} catch {}
	if (typeof process !== "undefined" && process.cwd) {
		const cwd = process.cwd();
		out.push(path.join(cwd, ".svelte-kit", "og-region-deps.json"));
		out.push(path.join(cwd, ".svelte-kit", "output", "server", "og-region-deps.json"));
	}
	return out;
}
function load() {
	if (cache) return cache;
	for (const p of candidates()) try {
		cache = JSON.parse(fs__default.readFileSync(p, "utf8"));
		return cache;
	} catch {}
	cache = {};
	return cache;
}
function pick(kind, entry) {
	const all = load();
	const map = all && typeof all[kind] === "object" ? all[kind] : kind === "js" ? all : null;
	const list = map ? map[entry] : null;
	return Array.isArray(list) ? list : [];
}
function islandDeps(entry) {
	return entry ? pick("js", entry) : [];
}
function islandCss(entry) {
	return entry ? pick("css", entry) : [];
}
function islandCssInline(href) {
	const all = load();
	const map = all && typeof all.css_inline === "object" && all.css_inline ? all.css_inline : null;
	if (!map || !href) return null;
	const v = map[href];
	return typeof v === "string" ? v : null;
}
function contentCss(id) {
	return id ? pick("content_css", id) : [];
}
function islandReadsPage(entry) {
	const all = load();
	const map = all && typeof all.page === "object" && all.page ? all.page : null;
	if (!map || !entry) return true;
	const v = map[entry];
	return v === void 0 ? true : !!v;
}
function islandPageKeys(entry) {
	const all = load();
	const map = all && typeof all.page_keys === "object" && all.page_keys ? all.page_keys : null;
	if (!map || !entry) return null;
	const v = map[entry];
	return Array.isArray(v) ? v : null;
}
function islandRemotes(entry) {
	const all = load();
	const map = all && typeof all.remotes === "object" && all.remotes ? all.remotes : null;
	if (!map || !entry) return null;
	const v = map[entry];
	return Array.isArray(v) ? v : null;
}
function islandInteractivity(entry) {
	const all = load();
	const map = all && typeof all.interactivity === "object" && all.interactivity ? all.interactivity : null;
	if (!map || !entry) return null;
	const v = map[entry];
	return v && typeof v === "object" ? v : null;
}
function fnManifest() {
	const m = load().fn_manifest;
	return m && typeof m === "object" && Object.keys(m).length ? m : null;
}
function entryLocation(identity) {
	const m = load().entries;
	const v = m && typeof m === "object" && identity ? m[identity] : null;
	return typeof v === "string" ? v : null;
}

export { islandCssInline as a, islandReadsPage as b, islandPageKeys as c, islandRemotes as d, entryLocation as e, islandInteractivity as f, islandCss as g, contentCss as h, islandDeps as i, fnManifest as j };
//# sourceMappingURL=island-deps.js-DRCEB_nS.js.map
