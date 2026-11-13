import { kit_boot_script } from './html-scan.ts';
import { inline_source } from './early-holes-csp.ts';

/** What Kit's start waits on: `DOMContentLoaded`, which comes after every deferred module script
 *  ran or failed, the runtime included. A runtime that fails to load never holds Kit back. */
export const KIT_START_WAIT =
	'new Promise((r) => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", r, { once: true }) : r())';

const KIT_IMPORT_RE = /\bimport\(\s*"(?:[^"\\\n]|\\.)*"\s*\)/;

/** A page with Kit's start gated: its HTML, the CSP hash source of Kit's new script text, and how
 *  much longer the HTML got. */
export type KitGate = { html: string; source: string; delta: number };

/**
 * THE BOOT ORDER ON A KIT PAGE (#1561): on a csr=true page that carries the runtime, Kit's start runs
 * after the runtime booted, so the runtime sees every lake as the server sent it before Kit can
 * hydrate or remount. `html` (its body ending at `body_end`) comes back with the first `import("…")`
 * of Kit's boot script, its start entry, waiting on {@link KIT_START_WAIT}. Only that expression
 * changes: Kit's global is still assigned during the parse (its streamed `resolve` scripts need it),
 * the script keeps its `nonce`, and a hash policy gets {@link KitGate.source}. `null` when the page
 * has no Kit boot script, it has no `import("…")` in that form, or it is gated already. Server-only.
 */
export function kit_gate(html: string, body_end: number): KitGate | null {
	const boot = kit_boot_script(html, body_end);
	if (!boot || boot.text.includes(KIT_START_WAIT)) return null;
	const found = KIT_IMPORT_RE.exec(boot.text);
	if (!found) return null;
	const gated = `${KIT_START_WAIT}.then(() => ${found[0]})`;
	const text =
		boot.text.slice(0, found.index) + gated + boot.text.slice(found.index + found[0].length);
	const at = boot.at + found.index;
	return {
		html: html.slice(0, at) + gated + html.slice(at + found[0].length),
		source: inline_source(text),
		delta: gated.length - found[0].length
	};
}
