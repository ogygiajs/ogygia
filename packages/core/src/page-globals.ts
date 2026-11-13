/**
 * The hooks separate bundles of one page hand each other through the window: the reshape restorer
 * (inlined as text, so it can import nothing), the runtime's router and morph, and the rules. Every
 * side reads and writes them through this one type, so a changed signature fails to compile on
 * both sides instead of drifting apart. Types only: nothing here ships.
 */

/** What the restorer recorded about one host. */
export interface RestoreLogEntry {
	kind: 'late' | 'mismatch' | 'sheet';
	host: string;
	t: number;
	diff?: string;
	/** `sheet`: the `og-shadow` key the page carries no sheet for. */
	key?: string;
	island?: string;
}

/** A shadow root whose sheets wait for it to go into the document. */
export type PendingShadow = ShadowRoot & { __og_pending?: CSSStyleSheet[] };

/** A root waiting to go in, with the time it was first seen out. */
export type WaitingShadow = ShadowRoot & { __og_out?: number };

/** The page-wide hooks, each optional: the bundle that sets it may not be on the page. */
export interface PageGlobals {
	/** The reshape restorer: restores a document, fragment or element; the count it restored. */
	__og_restore?: (root: ParentNode) => number;
	/** The reshape restorer's second half: adopts sheets into roots now in the document. */
	__og_restore_adopt?: () => void;
	/** What the restorer recorded (the devtools and the beacon read it too). */
	__og_restore_log?: RestoreLogEntry[];
	/** Shadow roots the restorer built while out of the document, waiting for their first sheets. */
	__og_init?: ShadowRoot[];
	/** Shadow roots with sheets to adopt once they are in the document. */
	__og_adopt?: { shadow: ShadowRoot; sheets: CSSStyleSheet[] }[];
	/** The rules take the router's head deny as its chunk loads (runtime/rules.ts). */
	__og_head_deny?: (deny: (node: Element) => boolean) => void;
	/** The rules hear each parse of an answer (runtime/html-sink.ts → runtime/rules.ts). */
	__og_parsed?: (fragment: DocumentFragment) => void;
}
