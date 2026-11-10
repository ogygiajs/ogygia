// The `ogygia:boot/…` modules. GENERATED from the virtual-module table
// (packages/core/src/compiler/virtual/core.ts): change an entry's `types` there, then run
// `node packages/core/scripts/virtual-types.ts`. A test fails while this file is stale.

declare module 'ogygia:boot/fn-manifest' {}
declare module 'virtual:ogygia/fn-manifest' {}

declare module 'ogygia:boot/runtime-entry' {}
declare module 'virtual:ogygia/runtime-entry' {}

declare module 'ogygia:boot/runtime-flags' {
	/** the `frames` feature is in the build: some region streams HTML */
	export const FRAMES: boolean;
}
declare module 'virtual:ogygia/runtime-flags' {
	/** the `frames` feature is in the build: some region streams HTML */
	export const FRAMES: boolean;
}

declare module 'ogygia:boot/hydrate-features' {
	/** installs the hydrate-phase features the app's marks selected */
	export function install(): void;
}
declare module 'virtual:ogygia/hydrate-features' {
	/** installs the hydrate-phase features the app's marks selected */
	export function install(): void;
}

declare module 'ogygia:boot/runtime' {}
declare module 'virtual:ogygia-runtime' {}

declare module 'ogygia:boot/devtools-meta' {
	/** island id → component name (a build; empty on the dev server) */
	export const names: Record<string, string>;
}
declare module 'virtual:ogygia/devtools-meta' {
	/** island id → component name (a build; empty on the dev server) */
	export const names: Record<string, string>;
}

declare module 'ogygia:boot/transport' {
	type CodecMap = Record<string, { encode: (v: unknown) => unknown; decode: (v: unknown) => unknown }>;
	export const transport: CodecMap;
	export const encoders: Record<string, (v: unknown) => unknown>;
	export const decoders: Record<string, (v: unknown) => unknown>;
}
declare module 'virtual:ogygia/transport' {
	type CodecMap = Record<string, { encode: (v: unknown) => unknown; decode: (v: unknown) => unknown }>;
	export const transport: CodecMap;
	export const encoders: Record<string, (v: unknown) => unknown>;
	export const decoders: Record<string, (v: unknown) => unknown>;
}

declare module 'ogygia:boot/transportables' {
	/** client: a transportable class module's tag path → its lazy import (server: empty, eager) */
	export const wire_loaders: Record<string, () => Promise<unknown>>;
	/** client: the app sends wired values through Kit's transport — every class loads with every island */
	export const wire_all: boolean;
}
declare module 'virtual:ogygia/transportables' {
	/** client: a transportable class module's tag path → its lazy import (server: empty, eager) */
	export const wire_loaders: Record<string, () => Promise<unknown>>;
	/** client: the app sends wired values through Kit's transport — every class loads with every island */
	export const wire_all: boolean;
}
