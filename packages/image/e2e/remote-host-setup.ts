// The fixture's remote image host for the whole run (playwright.config.ts `globalSetup`): a page
// rendered on request names `remoteImage()` files its server fetches then, and a server that loads
// no vite.config (`node build`, `wrangler dev`, the Vercel output) starts no host of its own. The
// port is taken once the build that held it ends; a server that loads the config and holds it
// (`vite preview`, the dev server) serves it instead.
import type http from 'node:http';
import { serve_remote_host } from './app/remote-host.ts';

const RETRY_MS = 250;

export default function setup(): () => Promise<void> {
	let server: http.Server | null = null;
	let stopped = false;
	const tries = (async () => {
		while (!stopped && server === null) {
			server = await serve_remote_host();
			if (server === null) await new Promise((done) => setTimeout(done, RETRY_MS));
		}
	})();
	return async () => {
		stopped = true;
		await tries;
		server?.closeAllConnections();
		server?.close();
	};
}
