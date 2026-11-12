/**
 * THE APP'S PASS, as ogygia runs it (`HtmlPass`): the HTML is marked before the transform and settled
 * after it (./reversible.ts), so the browser can put back what the transform moved before anything
 * hydrates (./restore.ts).
 */
import type { RequestEvent } from '@sveltejs/kit';
import type { HtmlPass } from '@ogygia/core/plugin';
import { DEV as dev } from 'esm-env';
import { OG_RESTORE, OG_STAND_INS } from '@ogygia/core/internal/server';
import { check_script, mark, settle, STAND_IN_CSS } from './reversible.ts';
import { restore, restore_adopt } from './restore.ts';
import type { ReshapeTransform } from './requests.ts';

/** The restorer, inline (./restore.ts — self-contained, so its source runs as is): restores the
 *  document now, and stays as `__og_restore` / `__og_restore_adopt` for hole answers and router swaps. */
const RESTORER_SCRIPT = `<script ${OG_RESTORE}>(function(){var r=${restore.toString()};window.__og_restore=r;window.__og_restore_adopt=${restore_adopt.toString()};r(document)})()</script>`;

export function reshape_pass(transform: ReshapeTransform, event: RequestEvent): HtmlPass {
	return {
		/**
		 * A DOCUMENT: marked, handed to the transform, settled. The head gets the transform's
		 * `data-og-head` assets (deduped) and, when the parser would have restructured a tag, the
		 * stand-ins' sheet; the body gets the restorer — inline, before `</body>`, so it runs before any
		 * island wakes, before Kit starts, and before a deferred module upgrades a host.
		 */
		async document(html, { csr, answer }) {
			// A page the router fetched is morphed into the live one, whose hosts their runtime already
			// rendered: it is an ANSWER, every host planned (./reversible.ts `plan_hosts`) — the router
			// restores it before the swap, so live and incoming hosts meet in one form.
			const marked = mark(html, 'document', csr, answer);
			const out = await transform(marked ? marked.html : html, { kind: 'document', csr, event });
			const s = marked ? settle(out, marked.record, { dev }) : null;
			// A page loaded as one keeps hosts in the transform's first-load form: if this copy ever
			// reaches the router (a store, a prerender, a cache), it loads it instead of swapping it in
			let first_load = false;
			if (marked && !answer)
				for (const h of marked.record.hosts.values()) if (!h.planned) first_load = true;
			return {
				html: s ? s.html : out,
				head:
					(s?.head.join('') ?? '') +
					(s?.stand_ins ? `<style ${OG_STAND_INS}>${STAND_IN_CSS}</style>` : '') +
					(first_load ? '<meta name="ogygia-first-load">' : ''),
				body: (s?.check ? check_script(s.check) : '') + RESTORER_SCRIPT
			};
		},
		/** A REGION ANSWER: marked, transformed, settled. The runtime restores it before insertion (and
		 *  hoists its `data-og-head` assets), so no stand-in sheet is needed. */
		async region(html) {
			const marked = mark(html, 'region', false);
			const out = await transform(marked ? marked.html : html, {
				kind: 'region',
				csr: false,
				event
			});
			if (!marked) return out;
			const s = settle(out, marked.record, { dev });
			return s.check ? s.html + check_script(s.check) : s.html;
		}
	};
}
