/**
 * The flags plugin's server realm (named by `flags()`).
 * `request`: prime the decision source once, above the page / hole split, so every read stays sync.
 * `done`: drain queued exposures at the request's end, always (the serverless-safe tail): the send
 * is returned, so the request's end hands it to the platform's `waitUntil` when there is one (#243);
 * the response never waits for it.
 */
import { defineServer, type ServerPlugin } from '@ogygia/core/plugin';
import { prime_flags, flush_exposures } from './index.ts';
import { set_flags_app } from './app.ts';

const server: ServerPlugin = defineServer({
	setup(app) {
		set_flags_app(app);
	},
	async request({ event }) {
		await prime_flags({ request: event.request, url: event.url, cookies: event.cookies });
	},
	done() {
		return flush_exposures();
	}
});
export default server;
