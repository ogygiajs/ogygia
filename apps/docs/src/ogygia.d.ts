/// <reference types="ogygia/types" />
/// <reference types="@ogygia/content/types" />

// Each release tag's date (`<package>@<version>` → `YYYY-MM-DD`), read from git at build (vite.config.ts).
declare module 'virtual:og-wasm' {
	type WasmInput = WebAssembly.Module | Uint8Array;
	/** Satori's yoga layout engine. */
	export const yoga: () => Promise<WasmInput>;
	/** resvg's rasteriser. */
	export const resvg: () => Promise<WasmInput>;
}

declare module 'virtual:release-dates' {
	const dates: Record<string, string>;
	export default dates;
}
