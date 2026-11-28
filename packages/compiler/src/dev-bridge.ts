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
}

/** The `Symbol.for` name of the dev bridge of the app at `root`. */
export const dev_bridge_key = (root: string): string => `ogygia.dev.bridge:${root}`;

/** A generated server module's call of the bridge's `reader` for the app at `root`: `undefined`
 *  while no dev server of that root is open. */
export const dev_bridge_call = (root: string, reader: keyof DevBridge): string =>
	`globalThis[Symbol.for(${JSON.stringify(dev_bridge_key(root))})]?.${reader}()`;

/** The global of a root, made at its first open and kept for the process: every bridge open there,
 *  answering with the newest one still open, and `undefined` while none is. */
export class DevBridgeSlot {
	/** the open bridges, oldest first */
	readonly open: DevBridge[] = [];

	fn_manifest(): Record<string, string> | undefined {
		return this.open.at(-1)?.fn_manifest();
	}
}

/** Opens `bridge` for the app at `root` over any other open there. Its close, run once by the
 *  scope of the dev server that opened it, takes only it away, so the newest one left answers. */
export function open_dev_bridge(root: string, bridge: DevBridge): () => void {
	const slots = globalThis as Record<symbol, DevBridgeSlot | undefined>;
	const slot = (slots[Symbol.for(dev_bridge_key(root))] ??= new DevBridgeSlot());
	slot.open.push(bridge);
	return () => {
		slot.open.splice(slot.open.indexOf(bridge), 1);
	};
}
