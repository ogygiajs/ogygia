import type { ServerApp } from '@ogygia/core/plugin';

let current: ServerApp | null = null;

export function set_fed_app(app: ServerApp | null): void {
	current = app;
}

/** The server process, set once by the server realm's `setup`, null before the plugin starts.
 *  `federate()` and a peer handle's loads run outside any hook and reach the request facts, the
 *  shared hooks and the app's signer through it. */
export function fed_app(): ServerApp | null {
	return current;
}
