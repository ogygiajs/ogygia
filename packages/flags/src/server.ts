import { defineServer, type ServerPlugin } from '@ogygia/core/plugin';
import { evaluate_flag, flush_exposures, prime_flags, set_request_vid } from './index.ts';
import { set_flags_app } from './app.ts';

const server: ServerPlugin = defineServer({
	setup(app) {
		set_flags_app(app);
	},
	async request({ event }) {
		const vid = event.cookies.get('og-vid');
		if (vid) set_request_vid(event.request, vid);
		await prime_flags({ request: event.request, url: event.url, cookies: event.cookies });
	},
	evaluateFlag(_request, event, name) {
		return evaluate_flag(name, { request: event.request, url: event.url, cookies: event.cookies });
	},
	done() {
		return flush_exposures();
	}
});
export default server;
