/**
 * The federation plugin's server realm (named by `federation()`).
 *
 * `setup`: hold the app (facts, shared hooks, signer) and install the deferred-hole signer.
 * `request`: a `federate()` in hooks.server.ts serves `/og/fragment/*`, `/og/thaw` and the
 * deferred-hole endpoint straight from the handle (no route files) — above the page split: these are
 * their own protocol. Any other path falls through.
 * `invalidated` (shared hook): every invalidation of this app's stored pages tells the peers that
 * baked its fragments. A peer is notified whether or not it has a key (a pure consumer still needs to
 * drop its SWR copies). The notices go through an outbox: the publish never waits for them (a peer
 * that is down never fails it), and the platform keeps them alive past its response (#286).
 */
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

	// (a shell's pages host its peers' islands, whose code loads from the peers)
	codeOrigins() {
		return current_federation()?.code_origins ?? [];
	},

	invalidated(tags) {
		const fed = current_federation();
		if (!fed) return;
		// (an outbox send: kept alive past this request's response, and a peer that never took it is
		// said once its tries are spent)
		void broadcast_thaw(fed, { id: crypto.randomUUID(), hop: 0, tags }); // ok: broadcast_thaw never rejects (an outbox put never does)
	}
});
export default server;
