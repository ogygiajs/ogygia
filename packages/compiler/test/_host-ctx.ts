// Shared by the region-transform suites that build a host-compile context by hand.

/** The host-compile fields a suite does not exercise, at exactly the values the transform falls back
 *  to when they are missing: `importKeys` → the default keys, no route `csr`, the client leg. (The
 *  optional fields, `idSalt`, `linkVirtualIsland`, `clientBindingStub` and `wrapperPathFor`, default
 *  themselves.) A suite spreads this first and overrides what it tests. */
export const HOST_CTX_DEFAULTS: {
	importKeys: undefined;
	routeCsr: boolean | undefined;
	ssr: boolean;
} = {
	importKeys: undefined,
	routeCsr: undefined,
	ssr: false
};
