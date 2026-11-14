import { random } from '@ogygia/machine';
import { defineServer, type ServerPlugin } from '@ogygia/core/plugin';
import { set_fed_app } from './app.ts';
import { install_federation, serve_federation } from './serve.ts';
import { current_federation } from './registry.ts';
import { broadcast_thaw } from './federate.ts';

const server: ServerPlugin = defineServer({
	setup(app) {
		set_fed_app(app);
		install_federation(app);
	},

	async request({ event }) {
		const res = await serve_federation(event);
		if (res) return res;
	},

	codeOrigins() {
		// @why a shell's pages host its peers' islands, whose code loads from the peers (test: test/code-origins.test.ts › are every peer’s origins, replicas included)
		return current_federation()?.code_origins ?? [];
	},

	invalidated(tags) {
		const fed = current_federation();
		if (!fed) return;
		// oxlint-disable-next-line ogygia/no-silent-failures -- broadcast_thaw never rejects (an outbox put never does)
		void broadcast_thaw(fed, { id: random.uuid(), hop: 0, tags });
	}
});
export default server;
