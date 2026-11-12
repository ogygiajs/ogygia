/**
 * DEVALUE, LOADED WHEN A PAGE NEEDS IT. A side-channel script crosses in one of two lanes
 * (server/props-wire.ts): plain JSON under `data-og-format="json"` (the common props and seed: a
 * payload with nothing devalue exists for), devalue otherwise. A page whose scripts are all JSON never
 * reads devalue, so it never downloads it: the first read that needs it starts its import beside the
 * load that leads there (an island's wake starts it with the hydrate core; a navigation, before its
 * preflight), never after it. The parse itself stays synchronous: by then the module is in.
 *
 * A leaf: island-side code (the page-defer resolver) imports it, so it imports nothing of the boot.
 *
 * A download that fails is tried again at once, and a failure is never kept: the next read loads it
 * afresh (one dropped request must not leave every later wake, and every streamed value, unreadable).
 */
import { backoffAfter, flights, STALE, timers, type Stale } from '@ogygia/machine';
import { import_again } from './import-again.ts';
import { devalue_download, download } from '../policies.ts';
import { OG_FORMAT, OGYGIA_PROPS } from '../wire-markup.ts';

type Devalue = typeof import('devalue');

let lib: Devalue | null = null;

const import_devalue = import_again(() => import('devalue'));

const devalue_load = flights({
	name: 'devalue',
	run: () => import_devalue().then((m) => (lib = m)),
	retry: download
});

/** Start (once) and await devalue's import. (Never STALE: nothing drops it.) */
export const load_devalue = (): Promise<Devalue | Stale> => devalue_load.get();

/** devalue, already loaded: a devalue-lane read only runs after its load ({@link load_devalue}). */
export function devalue(): Devalue {
	// (its code's link written out: this leaf imports nothing, see the top — messages/core.ts has it)
	if (!lib) throw new Error('[ogygia] https://ogygiajs.dev/e/devalue_not_loaded');
	return lib;
}

/** Run `fn` with devalue now when it is loaded, else once it is. Nothing else asks again for its
 *  caller (a streamed value's resolver runs once), so a failed download is asked for again later,
 *  as `devalue_download` says (`tried`: the loads that failed so far). */
export function with_devalue(fn: (d: Devalue) => void, tried = 0): void {
	if (lib) fn(lib);
	else
		void load_devalue().then(
			(d) => d !== STALE && fn(d),
			() => {
				const failed = tried + 1;
				if (failed >= devalue_download.attempts) return;
				// oxlint-disable-next-line ogygia/owned-effects -- the document's download retry, doubling and capped (it ends itself): the read it serves runs once and outlives any page, so no visit owns it
				timers.keep(() => with_devalue(fn, failed), backoffAfter(devalue_download, failed));
			}
		);
}

/** Every side-channel a read may parse with devalue: props sidecars, the page seed, page facts. */
const DEVALUE_LANE_SELECTOR =
	`script[${OGYGIA_PROPS}]:not([${OG_FORMAT}="json"]),` +
	`script[type="application/ogygia-page"]:not([${OG_FORMAT}="json"]),` +
	'script[type="application/ogygia-page-facts"]';

/** Does this document (or fragment) hold a script only devalue can read? */
export function needs_devalue(root: ParentNode): boolean {
	return root.querySelector(DEVALUE_LANE_SELECTOR) !== null;
}
