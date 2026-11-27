/**
 * THE DEV BRIDGE: what a dev server's generated server modules read off the compiler serving them,
 * as they run (the module text is made once; what it reads changes while dev runs). One global per
 * app root (by `Symbol.for` name), opened by the plugin's `configureServer` and closed with that
 * server (test/vite-hooks.test.ts › the dev bridge).
 *
 * @packageDocumentation
 */

/** The readers a dev server's generated server modules call, each answering now. */
export interface DevBridge {
	/** the og.$ factories the compiler holds (tag → factory source): `ogygia:server/region-deps`
	 *  `fn_manifest()` (apps/palaestra/e2e/dev-dollar-fn.spec.ts) */
	fn_manifest(): Record<string, string>;
	/** the app's identity on Kit's env channel: `ogygia:server/kit-env` `kit_env_build()`
	 *  (apps/palaestra/e2e/kit3.spec.ts) */
	kit_env_build(): string;
}

/** The `Symbol.for` name of the dev bridge of the app at `root`. */
export const dev_bridge_key = (root: string): string => `ogygia.dev.bridge:${root}`;

/** A generated server module's call of the bridge's `reader` for the app at `root`: `undefined`
 *  while no dev server of that root is open. */
export const dev_bridge_call = (root: string, reader: keyof DevBridge): string =>
	`globalThis[Symbol.for(${JSON.stringify(dev_bridge_key(root))})]?.${reader}()`;

/** Opens `bridge` for the app at `root`, in place of any other; its close removes it only while it
 *  is still the one open (a second dev server of the root opened its own since). */
export function open_dev_bridge(root: string, bridge: DevBridge): () => void {
	const key = Symbol.for(dev_bridge_key(root));
	const slots = globalThis as Record<symbol, unknown>;
	slots[key] = bridge;
	return () => {
		if (slots[key] === bridge) delete slots[key];
	};
}
