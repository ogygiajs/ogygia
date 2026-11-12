import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { federation } from '@ogygia/federation/vite';
import { router } from '@ogygia/router/vite';
import { flags } from '@ogygia/flags/vite';
import { postrender } from '@ogygia/postrender/vite';
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';

// THE SIMULATOR'S GENERATED APP (internal/sim/src/gen.ts writes its pages and regions from a seed).
// The router is on (unless the seed drew it off), so a link followed is a client navigation, as in
// most apps. Federation and the server router are there for a seed that draws a peer
// (apps/sim-gen-peer): its widgets on the app's pages, its pages mounted under /peer. Postrender is there for a command that publishes
// (`postrender.invalidate`, which a federated app announces to its peers), opt-in: no page is
// stored unless it says so. The presets are for a hole whose render the server keeps (`maxAge` is a
// preset's option, never an inline one): `hole-<age>[-<wake>]`.
const presets = Object.fromEntries(
	['2s', '30s'].flatMap((maxAge) =>
		[undefined, 'load', 'idle', 'visible', 'interaction'].map((wake) => [
			`hole-${maxAge}${wake ? `-${wake}` : ''}`,
			{ render: 'deferred' as const, maxAge, ...(wake ? { wake } : {}) }
		])
	)
);

// (a seed may draw an app without the router: `router` in the plan gen.ts wrote)
const plan: { router?: boolean } = existsSync('src/lib/gen/plan.json')
	? JSON.parse(readFileSync('src/lib/gen/plan.json', 'utf8'))
	: {};

export default defineConfig({
	plugins: [
		ogygia({ router: plan.router !== false, presets }),
		federation(),
		router(),
		// (a seed's flag: its reads reported, its exposures flushed at each request's end)
		flags(),
		postrender({ default: false }),
		sveltekit()
	]
});
