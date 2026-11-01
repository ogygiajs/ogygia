import { a as fnv1a32 } from './hash.js-C-SlWFdQ.js';

// ../../../flags/src/app.ts
var current = null;
function set_flags_app(app) {
	current = app;
}
function flags_app() {
	return current;
}
// ../../../flags/src/index.ts
/**
* `flag()` — the ONE assignment primitive. A kill switch, a rollout, a targeting rule, and an
* A/B/n test are the same thing: a name with variants, decided per visitor. This module owns the
* DECISION only; branching rides `flag.pick()` (a router page slot, or a value map), measurement
* rides the exposure sink, and vendor integration rides `decide({ source })`.
*
* Decision order per request (deterministic, sticky, ZERO-JS — it runs server-side during SSR and
* the chosen variant is simply what gets rendered, so csr=false pages A/B for free):
*   ?og-exp override (gated) → carried claims (a shell decided upstream) → the SOURCE
*   (OpenFeature / OFREP / any resolver, primed once per request) → the native rule
*   (targeting fn / weights) → the first variant (control / off).
*
* Everything the old surface split across `experiment` / `flag` / `layer` / `allowOverrides` /
* `onExposure` / `batchExposures` / `.bucket` / `.on` / `.stamp` collapses to: `flag()`, calling
* it, `.pick()`, `.value()`, and one `decide()`.
*/
/** Written by an upstream shell's identity hop (the fragment feature); absent = the tier is skipped. */
var CLAIMS = Symbol.for("ogygia.claims.v1");
/** Per-request source resolution, cached on the Request (GC'd with it). */
var RESOLVED = Symbol.for("ogygia.flags.resolved.v1");
/** 0..9999 — sticky hash bucket for (salt, visitor). Uniform + deterministic, not cryptographic;
*  the shared pure hash keeps this module safe in ANY bundle (runtime + every island entry). */
var pct = (s) => fnv1a32(s) % 1e4;
/** Who is this? The router identity (folds in carried claims) when present; raw claims / the
*  `og-vid` cookie (the router's `anonymousVisitor()` shape) otherwise; undefined = anonymous.
*  The ONE rule: a flag read hashes on its `sub`, and the source is primed with it as `c.visitor`. */
function visitor_of(c) {
	if (c.visitor?.sub) return c.visitor;
	const claims = c.request[CLAIMS];
	if (claims?.sub) return claims;
	const vid = c.cookies?.get("og-vid");
	return vid ? {
		sub: vid,
		anonymous: true
	} : c.visitor;
}
/** The sticky hash key. Anonymous → '' (weights degrade to the first variant there). */
function visitor_id(c) {
	return visitor_of(c)?.sub ?? "";
}
function carried(c, name) {
	return c.request[CLAIMS]?.experiments?.[name];
}
var _exposure = null;
var _queue = [];
var _timer = null;
function emit_exposure(e) {
	return;
}
/** Drain queued exposures to the sink. Called at each request's end (serverless-safe tail) and on
*  the size/age caps. A sink failure is contained — a lost batch is never a request's problem. */
function flush_exposures() {
	if (_timer) clearTimeout(_timer);
	_timer = null;
	if (_queue.length === 0) return;
	const batch = _queue;
	_queue = [];
	try {
		_exposure?.(batch);
	} catch {}
}
/** Every constructed flag self-registers here — the complete name list a source is asked for, and
*  the set federation auto-carries. Import your flags (route modules do this at startup; on plain
*  Kit, `import './flags'` in hooks.server.ts to prime the source from the first request). */
var _registry = /* @__PURE__ */ new Map();
/**
* Resolve the source ONCE per request over every registered flag, caching decisions on the
* Request so reads stay sync. Awaited by the flags plugin's `request` stage (flags/server.ts), above
* the page / hole split. Idempotent; a no-op without a source. Never throws — a source failure
* degrades every flag to its native rule, it does not take the request down.
*/
async function prime_flags(c) {
	return;
}
function resolved_for(c, name) {
	const map = c.request[RESOLVED];
	return map?.[name];
}
var _unstarted_warned = false;
/** Record the decided variant as a request fact: federation carries the set as signed claims. */
function record_assigned(c, name, variant) {
	const facts = flags_app()?.facts(c.request);
	if (facts) facts.assignments[name] = variant;
}
function override(c, name) {
	return void 0;
}
var _layers = /* @__PURE__ */ new Map();
function layer_member_for(group, v) {
	const members = _layers.get(group);
	if (!members || members.length === 0) return void 0;
	const lanes = [...members].sort();
	return lanes[pct(`layer:${group}:${v}`) % lanes.length];
}
function flag(name, shape, opts = {}) {
	const variants = ["off", "on"];
	const control = variants[0];
	const rollout = shape ;
	_registry.set(name, {
		name,
		variants,
		kind: "boolean"
	});
	if (opts.layer) {
		const members = _layers.get(opts.layer) ?? [];
		if (!members.includes(name)) members.push(name);
		_layers.set(opts.layer, members);
	}
	const memo = /* @__PURE__ */ new WeakMap();
	const compute = (c) => {
		const o = override();
		if (o && variants.includes(o)) return o;
		const carried_v = carried(c, name);
		if (carried_v && variants.includes(carried_v)) return carried_v;
		const src = resolved_for(c, name);
		if (src) return src.variant;
		const v = visitor_id(c);
		if (opts.layer && layer_member_for(opts.layer, v) !== name) return control;
		if (v) {
			const share = rollout * 100;
			if (pct(`${name}:${v}`) < share) return "on";
		}
		return control;
	};
	const bucket = (c) => {
		const app = flags_app();
		if (app) {
			const facts = app.facts(c.request);
			if (facts.perVisitor === null) facts.perVisitor = `flag:${name}`;
		} else if (!_unstarted_warned) {
			_unstarted_warned = true;
			console.warn("[ogygia] flags: a flag was read on the server but the flags plugin is not running — list `flags()` (from `@ogygia/flags/vite`) beside `ogygia()` in vite.config `plugins`. Until then flag reads are not reported to the request, and a stored page could keep one variant.");
		}
		const cached = memo.get(c.request);
		if (cached !== void 0) return cached;
		const variant = compute(c);
		memo.set(c.request, variant);
		record_assigned(c, name, variant);
		emit_exposure({
			sub: c.visitor?.sub,
			at: now()
		});
		return variant;
	};
	const value = (c) => {
		const raw = resolved_for(c, name)?.value;
		if (raw !== void 0 && opts.value) {
			const r = opts.value["~standard"].validate(raw);
			if (r && typeof r.then !== "function") {
				const res = r;
				if (!res.issues) return res.value;
			}
		} else if (raw !== void 0 && !opts.value) return raw;
		return opts.fallback;
	};
	const pick = (a, b) => {
		if (b === void 0) {
			const map = a;
			return { __ogpick: (c) => map[bucket(c)] ?? map[control] };
		}
		return b[bucket(a)] ?? b[control];
	};
	const call = (c) => bucket(c) === "on";
	Object.defineProperties(call, {
		name: {
			value: name,
			enumerable: true
		},
		variants: {
			value: variants,
			enumerable: true
		},
		stamp: {
			value: (c) => `${name}:${bucket(c)}`,
			enumerable: true
		},
		value: {
			value,
			enumerable: true
		},
		pick: {
			value: pick,
			enumerable: true
		}
	});
	return call;
}
/** `Date.now()` is unavailable in some sandboxes (workflow scripts); guard it so importing this
*  module never throws there — exposure timestamps are 0 in that case (and in dev). */
function now() {
	try {
		return Date.now();
	} catch {
		return 0;
	}
}

export { flag as a, flush_exposures as f, prime_flags as p, set_flags_app as s };
//# sourceMappingURL=src2.js-BDpoK-Iw.js.map
