/** Serialize a Kit `page` snapshot for a single document-level ogygia side-channel. */
import { stringify } from 'devalue';
import { escape_script_text } from '../escape.ts';

type PageLike = {
	url?: { href?: string };
	params?: Record<string, string>;
	route?: { id: string | null };
	status?: number;
	data?: unknown;
	form?: unknown;
	error?: unknown;
};

/** The seed's text and the lane it is in (`json` → the runtime reads it with `JSON.parse`). */
export interface SeedText {
	text: string;
	json: boolean;
}

// Promises in `data` (Kit streaming) are handled by the handle via `page-stream.ts`: STREAMED into the
// island on a real navigation, or awaited + settled for a programmatic fetch. By the time a value
// reaches PageSeed it is either promise-free or carries DeferRef/SettledRef markers the caller's
// reducers encode — so this module just serializes, robustly.
const DROP: unique symbol = Symbol('drop');

/**
 * A copy of `value` without the values `stringify_fn` cannot carry (a function, a symbol, a class
 * no reducer encodes): an object's key is left out, an array's slot reads `undefined` (later
 * indexes still point at what they did), a Map or Set loses that entry. Plain objects, arrays,
 * Maps and Sets are copied (one copy per source object, so shared and cyclic references keep their
 * shape); every other value is kept or left out whole, asked of `stringify_fn` itself so the app's
 * reducers decide. The source is not touched. Only for a slice whose whole serialization threw.
 */
function keep_serializable(value: unknown, stringify_fn: typeof stringify): unknown {
	const copies = new Map<object, unknown>();
	const carries = (v: unknown): boolean => {
		try {
			stringify_fn(v);
			return true;
			// oxlint-disable-next-line ogygia/no-silent-failures -- that is the answer: this value does not cross
		} catch {
			return false;
		}
	};
	const put = (out: Record<string, unknown>, key: string, v: unknown) => {
		if (key === '__proto__')
			Object.defineProperty(out, key, {
				value: v,
				enumerable: true,
				writable: true,
				configurable: true
			});
		else out[key] = v;
	};
	const keep = (v: unknown): unknown => {
		if (typeof v === 'function' || typeof v === 'symbol') return carries(v) ? v : DROP;
		if (v === null || typeof v !== 'object') return v;
		if (copies.has(v)) return copies.get(v);
		const proto = Object.getPrototypeOf(v);
		if (Array.isArray(v) && proto === Array.prototype) {
			const out: unknown[] = [];
			out.length = v.length; // (holes, not undefined: a hole stays a hole below)
			copies.set(v, out);
			for (let i = 0; i < v.length; i++) {
				if (!(i in v)) continue;
				const c = keep(v[i]);
				out[i] = c === DROP ? undefined : c;
			}
			return out;
		}
		if (proto === Object.prototype || proto === null) {
			const out = Object.create(proto) as Record<string, unknown>;
			copies.set(v, out);
			for (const key of Object.keys(v)) {
				let e: unknown;
				try {
					e = (v as Record<string, unknown>)[key];
					// oxlint-disable-next-line ogygia/no-silent-failures -- a getter that throws: devalue could not read it either
				} catch {
					continue;
				}
				const c = keep(e);
				if (c !== DROP) put(out, key, c);
			}
			return out;
		}
		if (proto === Map.prototype) {
			const out = new Map<unknown, unknown>();
			copies.set(v, out);
			for (const [k, e] of v as Map<unknown, unknown>) {
				const ck = keep(k);
				const ce = keep(e);
				if (ck !== DROP && ce !== DROP) out.set(ck, ce);
			}
			return out;
		}
		if (proto === Set.prototype) {
			const out = new Set<unknown>();
			copies.set(v, out);
			for (const e of v as Set<unknown>) {
				const c = keep(e);
				if (c !== DROP) out.add(c);
			}
			return out;
		}
		const kept = carries(v) ? v : DROP;
		copies.set(v, kept);
		return kept;
	};
	const out = keep(value);
	return out === DROP ? undefined : out;
}

export class PageSeed {
	/**
	 * Public page slice for islands. url/params/route/status are always plain and MUST survive;
	 * data/form/error may carry a non-serializable leaf (function/store/class) — that leaf is left
	 * out where it sits (`keep_serializable`), never its field or the whole seed. Promises should already be resolved by the handle
	 * (`resolve_promises`) before this. See INVARIANTS.md · PAGE-SEED.
	 *
	 * `json`: the caller proved the whole slice JSON-exact (seed-refs.ts `analyze`) — then the seed
	 * goes out as native `JSON.stringify` output (an order of magnitude cheaper than devalue on a
	 * CMS tree), escaped once for the `<script>`. devalue output needs no escape (it writes `<`).
	 */
	static serialize(
		page_ref: PageLike,
		stringify_fn: typeof stringify = stringify,
		json = false
	): SeedText | null {
		try {
			const base = {
				url: page_ref.url?.href,
				params: page_ref.params,
				route: page_ref.route,
				status: page_ref.status
			};
			const full = {
				...base,
				data: page_ref.data,
				form: page_ref.form ?? null,
				error: page_ref.error ?? null
			};
			if (json) {
				try {
					return { text: escape_script_text(JSON.stringify(full)), json: true };
					// oxlint-disable-next-line ogygia/no-silent-failures -- the analysis was wrong about a leaf; devalue below is the safe lane
				} catch {}
			}
			let raw: string;
			try {
				raw = stringify_fn(full);
			} catch {
				// A value devalue cannot carry must not take its neighbours with it: islands' props
				// sidecars point into `data` by path, so only the values that cannot go are left out.
				// (the copy itself may throw: data nested past the stack, a Map whose iterator throws;
				// then the source goes to the per-field fallback below, never the whole seed lost)
				let kept = full;
				try {
					kept = keep_serializable(full, stringify_fn) as typeof full;
					// oxlint-disable-next-line ogygia/no-silent-failures -- kept stays the source
				} catch {}
				try {
					raw = stringify_fn(kept);
				} catch {
					// (a reducer that throws on the copy, or no copy: each field that serializes alone)
					const safe: Record<string, unknown> = { ...base };
					for (const key of ['data', 'form', 'error'] as const) {
						try {
							stringify_fn(kept[key]);
							safe[key] = kept[key];
							// oxlint-disable-next-line ogygia/no-silent-failures -- this field cannot cross, so just it is dropped
						} catch {}
					}
					raw = stringify_fn(safe);
				}
			}
			return { text: raw, json: false };
			// oxlint-disable-next-line ogygia/no-silent-failures -- a reducer threw on the plain base itself; the page ships no seed, never a 500
		} catch {
			return null;
		}
	}
}
