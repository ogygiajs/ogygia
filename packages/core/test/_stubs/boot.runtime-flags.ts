// Test stub for `ogygia:boot/runtime-flags` (the real one is generated from the app's marks by
// the compiler, link/runtime-entry.ts): every feature's path kept, like the dev build. `WIRE` off
// keeps the on-use codec load (a no-op while the hydrate features installed the codec), so a test
// can take the codec out and watch a wake bring it back (test/browser/wire-on-use.test.ts).
export const FRAMES = true;
export const WIRE = false;
