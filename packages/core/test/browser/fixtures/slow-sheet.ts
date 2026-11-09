// A region stylesheet that takes a while to arrive (dev serves a region's CSS as a module: see
// runtime/core.ts `region_fragment`). A frame that links it waits for it before it paints.
await new Promise((resolve) => setTimeout(resolve, 300));
export {};
