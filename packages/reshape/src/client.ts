/**
 * The reshape plugin's browser realm (named by `reshape()`): what the page needs around the restorer
 * the pass inlines (./pass.ts). The restorer itself is that inline script (`__og_restore`,
 * `__og_restore_adopt`); this realm reports what it recorded, restores each region answer before
 * anything reads it, and keeps a web component's own class tokens through Svelte's hydrate.
 */
import { defineClient, type ClientPlugin } from '@ogygia/core/plugin/client';
import { keep_host_classes, note_host_classes } from './host-classes.ts';
import { report_restores } from './restore-report.ts';

type RestoreWindow = {
	__og_restore?: (root: ParentNode) => number;
	__og_restore_adopt?: () => void;
};

const client: ClientPlugin = defineClient({
	boot({ kitPage }) {
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
			(window as RestoreWindow).__og_restore?.(fragment);
		},
		answerPlaced() {
			(window as RestoreWindow).__og_restore_adopt?.();
		}
	}
});
export default client;
