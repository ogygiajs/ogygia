/**
 * The reshape plugin's server realm (named by `reshape()`): it answers ogygia's `pass` for every
 * request `handle()` wrapped.
 */
import { defineServer, type ServerPlugin } from '@ogygia/core/plugin';
import { reshape_pass } from './pass.ts';
import { slot } from './requests.ts';

const server: ServerPlugin = defineServer({
	setup() {
		slot.live = true;
	},
	pass(event) {
		const transform = slot.by_request.get(event.request);
		return transform ? reshape_pass(transform, event) : undefined;
	}
});
export default server;
