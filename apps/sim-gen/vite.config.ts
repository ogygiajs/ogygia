import { sveltekit } from '@sveltejs/kit/vite';
import { definePlugin, ogygia } from 'ogygia/vite';
import { federation } from '@ogygia/federation/vite';
import { router } from '@ogygia/router/vite';
import { flags } from '@ogygia/flags/vite';
import { postrender } from '@ogygia/postrender/vite';
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE SIMULATOR'S GENERATED APP (internal/sim/src/gen.ts writes its pages and regions from a seed).
// The router is on (unless the seed drew it off), so a link followed is a client navigation, as in
// most apps. Federation and the server router are there for a seed that draws a peer
// (apps/sim-gen-peer): its widgets on the app's pages, its pages mounted under /peer. Postrender is there for a command that publishes
// (`postrender.invalidate`, which a federated app announces to its peers), opt-in: no page is
// stored unless it says so. The presets are for a hole whose render the server keeps (`maxAge` is a
// preset's option, never an inline one): `hole-<age>[-<fetch>]`.
const presets = Object.fromEntries(
	['2s', '30s'].flatMap((maxAge) =>
		[undefined, 'load', 'idle', 'visible', 'interaction'].map((fetch) => [
			`hole-${maxAge}${fetch ? `-${fetch}` : ''}`,
			{ render: 'deferred' as const, maxAge, ...(fetch ? { fetch } : {}) }
		])
	)
);

// (a seed may draw an app without the router: `router` in the plan gen.ts wrote; and the presets its
// regions with a margin name, `presets`: a margin is never an inline attribute)
const plan: { router?: boolean; presets?: Record<string, Record<string, string>> } = existsSync(
	'src/lib/gen/plan.json'
)
	? JSON.parse(readFileSync('src/lib/gen/plan.json', 'utf8'))
	: {};

export default defineConfig({
	plugins: [
		ogygia({ router: plan.router !== false, presets: { ...presets, ...plan.presets } }),
		// (the simulator's ear: a repair's ownership conflict said on the console, src/sim-client.ts)
		definePlugin({
			name: 'sim-gen',
			client: fileURLToPath(new URL('./src/sim-client.ts', import.meta.url))
		}),
		federation(),
		router(),
		// (a seed's flag: its reads reported, its exposures flushed at each request's end)
		flags(),
		postrender({ default: false }),
		sveltekit()
	]
});
