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
