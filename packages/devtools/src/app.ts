/**
 * The server process, as the devtools plugin sees it — set once by the server realm's `setup`. The
 * profiler runs as the plugin's `handle` (or on its own, as `profiler()`), and keeps its sink's posts
 * alive past a response through it (`app.keepAlive`). Null before the plugin starts (a unit test, or
 * a `profiler()` used without the plugin: its posts then run on in the process).
 *
 * One global slot: the app's import and the server half the build lists can be two module instances.
 */
import type { ServerApp } from '@ogygia/core/plugin';
import { slot as shared } from '@ogygia/machine';

const slot = shared<{ app: ServerApp<unknown> | null }>({
	name: 'ogygia.devtools.app',
	version: 1,
	make: () => ({ app: null })
});

export function set_devtools_app(app: ServerApp<unknown> | null): void {
	slot.app = app;
}

export function devtools_app(): ServerApp<unknown> | null {
	return slot.app;
}
