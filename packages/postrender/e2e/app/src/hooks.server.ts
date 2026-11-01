import { sequence } from '@sveltejs/kit/hooks';
import * as ogygia from 'ogygia/server';
import { postrender, akamai, cloudfront, type EdgeAdapter } from '@ogygia/postrender';
import { env } from '$env/dynamic/private';
import { routes, page, layout } from '@ogygia/router';
import Shell from '$lib/r/Shell.svelte';
import Stored from '$lib/r/Stored.svelte';
import Plain from '$lib/r/Plain.svelte';
import Off from '$lib/r/Off.svelte';

// Edge adapters point at the harness's EMULATORS when their base URLs are set (../postrender.spec.ts
// boots them) — the REAL adapters run unchanged, signing included; the emulators verify the
// signature STRUCTURE and speak each CDN's real purge API. No env → origin store only (lane 1).
const edge: EdgeAdapter[] = [];
if (env.EDGE_AKAMAI_URL) {
	edge.push(
		akamai({
			host: 'akab-emulated.purge.akamaiapis.net',
			clientToken: 'emu-client-token',
			clientSecret: 'emu-client-secret',
			accessToken: 'emu-access-token',
			site: env.EDGE_SITE_URL || 'http://127.0.0.1:3073',
			baseUrl: env.EDGE_AKAMAI_URL
		})
	);
}
if (env.EDGE_CF_URL) {
	edge.push(
		cloudfront({
			distributionId: 'EMULATED123',
			accessKeyId: 'AKIAEMULATED',
			secretAccessKey: 'emulated-secret',
			baseUrl: env.EDGE_CF_URL
		})
	);
}

// A programmatic table mounted INSIDE ogygia's handle (deck S17): Kit's file router never claims
// /r/*, so `event.route.id` is null there and the handle asks the table. `page(C, { config })`
// merges page > layout > table like Kit's `config`; unset follows the vite-config default (on).
const shell = layout('r', Shell, { config: { postrender: true } }); // layout-level opt-in…
const app = routes({
	...shell({
		'/r/stored': page(Stored),
		'/r/off': page(Off, { config: { postrender: false } }) // …a page below overrides it
	}),
	'/r/plain': page(Plain) // nothing set anywhere → vite-config default (on)
});

// The setup mistakes the read path names (../postrender-order.spec.ts): `POSTRENDER_HOOKS=misordered`
// puts postrender's handle AFTER ogygia's, `missing` leaves it out. Unset = the right order.
const mode = env.POSTRENDER_HOOKS;
const ogygia_handle = ogygia.handle();
export const handle =
	mode === 'missing'
		? sequence(ogygia_handle, app.handle)
		: mode === 'misordered'
			? sequence(ogygia_handle, postrender.handle({ edge }), app.handle)
			: sequence(postrender.handle({ edge }), ogygia_handle, app.handle);
