/**
 * devalue, loaded when a page needs it. A side-channel script crosses in one of two lanes
 * (server/props-wire.ts): plain JSON under `data-og-format="json"`, devalue otherwise; only a
 * script in the devalue lane needs it. The parse stays synchronous: a read runs once the module is
 * in. A dropped download is tried again at once, its failure is never kept (the next read loads it
 * afresh), and a read that runs once asks again later (test/browser/devalue-lane*.test.ts).
 *
 * @packageDocumentation
 */
import { backoffAfter, flights, STALE, type Stale } from '@ogygia/machine';
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
				setTimeout(() => with_devalue(fn, failed), backoffAfter(devalue_download, failed));
			}
		);
}

const DEVALUE_LANE_SELECTOR =
	`script[${OGYGIA_PROPS}]:not([${OG_FORMAT}="json"]),` +
	`script[type="application/ogygia-page"]:not([${OG_FORMAT}="json"]),` +
	'script[type="application/ogygia-page-facts"]';

/** Does this document (or fragment) hold a script only devalue can read: a props sidecar or the
 *  page seed not in the JSON lane, or page facts? */
export function needs_devalue(root: ParentNode): boolean {
	return root.querySelector(DEVALUE_LANE_SELECTOR) !== null;
}
