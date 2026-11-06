/**
 * DEVALUE, LOADED WHEN A PAGE NEEDS IT. A side-channel script crosses in one of two lanes
 * (server/props-wire.ts): plain JSON under `data-og-format="json"` (the common props and seed: a
 * payload with nothing devalue exists for), devalue otherwise. A page whose scripts are all JSON never
 * reads devalue, so it never downloads it: the first read that needs it starts its import beside the
 * load that leads there (an island's wake starts it with the hydrate core; a navigation, before its
 * preflight), never after it. The parse itself stays synchronous: by then the module is in.
 *
 * A leaf: island-side code (the page-defer resolver) imports it, so it imports nothing of the boot.
 */
type Devalue = typeof import('devalue');

let lib: Devalue | null = null;
let loading: Promise<Devalue> | null = null;

/** Start (once) and await devalue's import. */
export function load_devalue(): Promise<Devalue> {
	return (loading ??= import('devalue').then((m) => (lib = m)));
}

/** devalue, already loaded: a devalue-lane read only runs after its load ({@link load_devalue}). */
export function devalue(): Devalue {
	if (!lib)
		throw new Error(
			'[ogygia] a devalue-lane payload was read before devalue loaded (load_devalue() first)'
		);
	return lib;
}

/** Run `fn` with devalue now when it is loaded, else once it is. */
export function with_devalue(fn: (d: Devalue) => void): void {
	if (lib) fn(lib);
	else void load_devalue().then(fn);
}

/** Every side-channel a read may parse with devalue: props sidecars, the page seed, page facts. */
const DEVALUE_LANE_SELECTOR =
	'script[data-ogygia-props]:not([data-og-format="json"]),' +
	'script[type="application/ogygia-page"]:not([data-og-format="json"]),' +
	'script[type="application/ogygia-page-facts"]';

/** Does this document (or fragment) hold a script only devalue can read? */
export function needs_devalue(root: ParentNode): boolean {
	return root.querySelector(DEVALUE_LANE_SELECTOR) !== null;
}
