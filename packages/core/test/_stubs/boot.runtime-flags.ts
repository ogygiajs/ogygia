// Test stub for `ogygia:boot/runtime-flags` (the real one is generated from the app's marks by
// the compiler, link/runtime-entry.ts): every feature's path kept, like the dev build. The codec's
// on-use load is kept too (a no-op while the hydrate features installed the codec), so a test can
// take the codec out and watch a wake bring it back (test/browser/wire-on-use.test.ts).
export const FRAMES = true;
export const load_wire_codec = () => import('../../src/live-transport.ts');
