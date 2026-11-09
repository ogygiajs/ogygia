import { definePlugin, type OgygiaPlugin } from 'ogygia/vite';

/** The fixture's plugin that answers some page requests itself: see ./server.ts. */
export function later_answer(): OgygiaPlugin {
	return definePlugin({
		name: 'postrender-e2e-later-answer',
		server: import.meta.resolve('./server.ts')
	});
}
