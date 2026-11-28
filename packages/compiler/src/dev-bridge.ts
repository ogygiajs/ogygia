/**
 * THE OPEN DEV SERVERS of an app root: one registry, a `Symbol.for` global per root, of every dev
 * server a plugin serves there, each held while that server is open (its own scope). The plugin
 * reads it to find the server a hook runs on and every server a program-wide change goes to; a dev
 * server's generated server modules read the newest one's bridge off it, as they run (the module
 * text is made once; what it reads changes while dev runs) (test/vite-hooks.test.ts › the dev
 * bridge).
 *
 * @packageDocumentation
 */
import { registry, type Registry, type Scope } from '@ogygia/machine';
import type { ViteDevServer } from 'vite';

/** The readers a dev server's generated server modules call, each answering now. */
export interface DevBridge {
	/** the og.$ factories the compiler holds (tag → factory source): `ogygia:server/region-deps`
	 *  `fn_manifest()` (apps/palaestra/e2e/dev-dollar-fn.spec.ts) */
	fn_manifest(): Record<string, string>;
	/** the app's identity on Kit's env channel: `ogygia:server/kit-env` `kit_env_build()`
	 *  (apps/palaestra/e2e/kit3.spec.ts) */
	kit_env_build(): string;
}

/** One open dev server: the scope it serves in (closed when it closes), its environments, the
 *  plugin serving it (its dev scope) and the bridge its generated server modules read. */
export interface DevServed {
	readonly scope: Scope;
	readonly server: ViteDevServer;
	readonly environments: ReadonlySet<object>;
	readonly plugin: Scope;
	readonly bridge: DevBridge;
}

/** The `Symbol.for` name of the open dev servers of the app at `root`. */
export const dev_bridge_key = (root: string): string => `ogygia.dev.bridge:${root}`;

/** A generated server module's call of the bridge's `reader` for the app at `root`: `undefined`
 *  while no dev server of that root is open. */
export const dev_bridge_call = (root: string, reader: keyof DevBridge): string =>
	`globalThis[Symbol.for(${JSON.stringify(dev_bridge_key(root))})]?.${reader}()`;

/** The global of a root: its open dev servers, oldest first, answering the bridge's readers with the
 *  newest one still open (nothing while none is). It is the root's global while one is open. */
export class DevServers {
	readonly open: Registry<DevServed> = registry<DevServed>();
	readonly #slot: symbol;

	constructor(slot: symbol) {
		this.#slot = slot;
	}

	/** Holds `at` while its scope is open; when the last one closes, the root's global goes. */
	add(at: DevServed): void {
		this.open.add(at, at.scope);
		at.scope.defer(() => {
			const slots = globalThis as Record<symbol, DevServers | undefined>;
			if (this.open.size === 0 && slots[this.#slot] === this) delete slots[this.#slot];
		});
	}

	fn_manifest(): Record<string, string> | undefined {
		return this.newest()?.bridge.fn_manifest();
	}

	kit_env_build(): string | undefined {
		return this.newest()?.bridge.kit_env_build();
	}

	/** The newest dev server still open, of `plugin` when given. */
	newest(plugin?: Scope): DevServed | undefined {
		const all = this.open.snapshot();
		for (let i = all.length - 1; i >= 0; i--)
			if (plugin === undefined || all[i]!.plugin === plugin) return all[i];
		return undefined;
	}
}

/** The open dev servers of the app at `root`: one global per root, made on first use and gone
 *  when its last open server closes. */
export function dev_servers(root: string): DevServers {
	const slots = globalThis as Record<symbol, DevServers | undefined>;
	const slot = Symbol.for(dev_bridge_key(root));
	return (slots[slot] ??= new DevServers(slot));
}
