// The `ogygia:region/…` modules. GENERATED from the virtual-module table
// (packages/core/src/compiler/virtual/core.ts): change an entry's `types` there, then run
// `node packages/core/scripts/virtual-types.ts`. A test fails while this file is stale.

declare module 'ogygia:region/kit-transport' {
	type CodecMap = Record<string, { encode: (v: unknown) => unknown; decode: (v: unknown) => unknown }>;
	export const transport: CodecMap;
}
declare module 'virtual:ogygia/kit-transport' {
	type CodecMap = Record<string, { encode: (v: unknown) => unknown; decode: (v: unknown) => unknown }>;
	export const transport: CodecMap;
}

declare module 'ogygia:region/transportables-eager' {}
declare module 'virtual:ogygia/transportables-eager' {}
