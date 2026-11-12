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
