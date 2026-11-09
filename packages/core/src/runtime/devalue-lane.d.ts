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
import { type Stale } from '@ogygia/machine';
type Devalue = typeof import('devalue');
/** Start (once) and await devalue's import. (Never STALE: nothing drops it.) */
export declare const load_devalue: () => Promise<Devalue | Stale>;
/** devalue, already loaded: a devalue-lane read only runs after its load ({@link load_devalue}). */
export declare function devalue(): Devalue;
/** Run `fn` with devalue now when it is loaded, else once it is. Nothing else asks again for its
 *  caller (a streamed value's resolver runs once), so a failed download is asked for again later,
 *  as `devalue_download` says (`tried`: the loads that failed so far). */
export declare function with_devalue(fn: (d: Devalue) => void, tried?: number): void;
/** Does this document (or fragment) hold a script only devalue can read? */
export declare function needs_devalue(root: ParentNode): boolean;
export {};
