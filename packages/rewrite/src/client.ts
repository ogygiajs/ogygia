/**
 * The rewrite plugin's browser realm (named by `rewrite()`): what the page needs around the restorer.
 * A document a rewrite restored something in carries the restorer inline (`__og_restore`,
 * `__og_restore_adopt`); a page that has none yet gets this realm's copy, for the region answers it
 * fetches. This realm reports what the restorer recorded, restores each region answer before
 * anything reads it, and keeps a web component's own class tokens through Svelte's hydrate.
 */
import { defineClient, type ClientPlugin, type PageGlobals } from '@ogygia/core/plugin/client';
import { keep_host_classes, note_host_classes } from './host-classes.ts';
import { report_restores } from './restore-report.ts';
import { restore, restore_adopt } from './restore.ts';

const client: ClientPlugin = defineClient({
	boot({ kitPage }) {
		const w = window as PageGlobals;
		w.__og_restore ??= restore as NonNullable<PageGlobals['__og_restore']>;
		w.__og_restore_adopt ??= restore_adopt;
		// (a Kit-hydrated page: ogygia's runtime does not boot there, so it never reported either)
		if (!kitPage) report_restores();
	},
	hooks: {
		regionHydrate({ el }) {
			const noted = note_host_classes(el);
			return noted ? () => keep_host_classes(noted) : undefined;
		},
		answerParsed({ fragment }) {
			// (the page's restorer, read now: the report wraps it at boot)
			(window as PageGlobals).__og_restore?.(fragment);
		},
		answerPlaced() {
			(window as PageGlobals).__og_restore_adopt?.();
		}
	}
});
export default client;
