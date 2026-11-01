/**
 * The server process, as the postrender plugin sees it — set once by the server realm's `setup`. The
 * app-facing API (`postrender.invalidate`, `postrender.handle`) runs outside any plugin hook and
 * reaches the shared hooks and the devtools stream through it. Null before the plugin starts (a unit
 * test that never starts it, or an app that lists no `postrender()` in vite.config).
 *
 * One global slot, like the registry's: the app's import and the server half the build lists can be
 * two module instances.
 */
import type { ServerApp } from '@ogygia/core/plugin';
import type { PostrenderServerOptions } from './server.ts';

const slot: { app: ServerApp<PostrenderServerOptions> | null } = ((
	globalThis as Record<symbol, { app: ServerApp<PostrenderServerOptions> | null } | undefined>
)[Symbol.for('ogygia.postrender.app.v1')] ??= { app: null });

export function set_postrender_app(app: ServerApp<PostrenderServerOptions> | null): void {
	slot.app = app;
}

export function postrender_app(): ServerApp<PostrenderServerOptions> | null {
	return slot.app;
}
