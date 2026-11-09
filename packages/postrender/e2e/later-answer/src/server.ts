// A plugin listed AFTER postrender that answers some page requests itself (an A/B redirect, a
// maintenance page): its `page()` answer means postrender's `response()` never runs for that
// request. A request carrying `x-later-answer: 1` is answered here (../postrender.spec.ts S20).
import { defineServer, type ServerPlugin } from 'ogygia/plugin';

const server: ServerPlugin = defineServer({
	page(ctx) {
		if (ctx.event.request.headers.get('x-later-answer') === '1')
			return new Response('answered by a later plugin', {
				headers: { 'content-type': 'text/plain', 'x-later-answer': '1' }
			});
	}
});
export default server;
