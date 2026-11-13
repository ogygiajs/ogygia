/**
 * The rewrite plugin's server realm (named by `rewrite()`): it answers ogygia's `pass` for every
 * request a `rewrite()` handle wrapped, and notes each request ogygia's handle starts, so a rewrite
 * listed after it is refused.
 */
import { defineServer, type ServerPlugin } from '@ogygia/core/plugin';
import { rewrite_pass } from './pass.ts';
import { slot } from './requests.ts';

const server: ServerPlugin = defineServer({
	setup() {
		slot.live = true;
	},
	request({ event }) {
		slot.started.add(event.request);
	},
	pass(event) {
		const steps = slot.by_request.get(event.request);
		return steps ? rewrite_pass(steps, event) : undefined;
	}
});
export default server;
