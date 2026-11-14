/**
 * `jumpstart()`: the server build in a few files, so a cold start reads a few files instead of
 * hundreds. Listed beside `ogygia()`:
 *
 *   plugins: [ogygia(), jumpstart({ external: ['sharp'] }), sveltekit()]
 *
 * It changes the SSR build only: dependencies are bundled in (`noExternal`), the framework and
 * every dependency go in one chunk, and each region registry (a script module that marks region
 * imports) in a chunk of its own, which only a page that imports it loads. The client build and dev
 * are not touched, and pages are served byte for byte as without it.
 */
import type { Plugin } from 'vite';
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';
import { Options, type JumpstartOptions } from './options.ts';
import { ServerChunks } from './server-chunks.ts';

export type { JumpstartOptions } from './options.ts';

/** The jumpstart plugin: its ogygia definition (to read the region table), and the Vite hooks that
 *  shape the server build. */
export function jumpstart(options: JumpstartOptions = {}): [OgygiaPlugin, Plugin] {
	const chunks = new ServerChunks(new Options(options));
	return [
		definePlugin({ name: '@ogygia/jumpstart', build: (b) => chunks.attach(b.regions) }),
		chunks.plugin()
	];
}
