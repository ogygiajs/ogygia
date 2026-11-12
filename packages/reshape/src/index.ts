/**
 * `@ogygia/reshape` — an app's own pass over the HTML ogygia sends (a web-component server render, a
 * translation proxy), and the markup helpers around it. Kit-free at runtime, so the helpers run
 * anywhere: the non-SvelteKit half of a monorepo, a vitest corpus in jsdom.
 *
 * - `handle(transform)`: the pass, as a Kit handle in front of ogygia's
 *   (`sequence(reshape.handle(transform), ogygia.handle())`, with `reshape()` in vite.config).
 * - `scanRegions` / `liftRegions` / `restoreRegions`: find every region in a document, or lift them
 *   out around a foreign SSR pass and splice them back.
 * - `transformMarkup`: the server round trip of the pass — mark, the transform, settle — for a test
 *   that runs an app's transform over harvested markup; `checkScript(settled.check)` is the dev
 *   check's payload to put in front of it (with `{ dev: true }`), so `restore` checks each host.
 * - `localizeMarks`: stable mark ids for a transform that caches its renders by markup.
 * - `restore`: the browser half, on a parsed document or fragment — what the pass inlines in every
 *   page it runs on.
 */
import type { Handle } from '@ogygia/core/plugin';
import { OgygiaError } from './messages.ts';
import { slot, type ReshapeTransform } from './requests.ts';

export type { ReshapeTransform };

/**
 * The app's own pass over the HTML ogygia sends, as a Kit handle. Put it before ogygia's, and list
 * `reshape()` (from `@ogygia/reshape/vite`) beside `ogygia()` in vite.config:
 *
 * ```ts
 * // src/hooks.server.ts
 * import { sequence } from '@sveltejs/kit/hooks';
 * import * as ogygia from 'ogygia/server';
 * import * as reshape from '@ogygia/reshape';
 * export const handle = sequence(reshape.handle(render), ogygia.handle());
 * ```
 *
 * @param transform - Post-processes the HTML ogygia sends — every document (the chunk carrying
 * `</head>`; a streamed tail passes untouched) and every region answer (a hole, a lake remount) — e.g.
 * a web-component server render. `html` in, `html` out, may be async; it is on the response path, so
 * keep it fast. Its type is `ReshapeTransform`, for a transform written in a module of its own.
 *
 * It may reshape Svelte-owned markup. ogygia marks the HTML before the call and restores in the
 * browser, before anything hydrates, what the transform moved:
 * - a custom element marked `og-h` is one ogygia restores (in Svelte-owned markup, above it, or in a
 *   region answer). To reshape it, render its plan: its slot positions as `<slot>` elements wrapping
 *   the moved children, `og-shadow="key …"` (the keyed sheets for its shadow root), and optionally
 *   `og-keep="attr …"` (attributes you added that survive the restore; never per-render state). One
 *   without `og-shadow` is left exactly as Svelte wrote it.
 * - `<template data-og-head="key">css</template>` is a shadow sheet; `<style>` / `<link>` with
 *   `data-og-head="key"` apply to the page. Both go into `<head>`, once per key.
 * - everything else `og-*` is ogygia's: carry it along wherever you move a node; it is gone from the
 *   final DOM.
 */
export function handle(transform: ReshapeTransform): Handle {
	return ({ event, resolve }) => {
		// (without the plugin nothing would run the transform: say so on every request instead)
		if (!slot.live) throw new OgygiaError('reshape_plugin_missing');
		slot.by_request.set(event.request, transform);
		return resolve(event);
	};
}

export {
	scanRegions,
	liftRegions,
	restoreRegions,
	type RegionKind,
	type RegionSpan,
	type LiftedRegion,
	type LiftResult
} from './split-regions.ts';
export {
	transformMarkup,
	localizeMarks,
	check_script as checkScript,
	type Settled,
	type TransformKind
} from './reversible.ts';
export { restore } from './restore.ts';
