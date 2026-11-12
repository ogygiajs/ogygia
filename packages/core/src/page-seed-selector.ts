/** The page's own seed (`page.data`, url, params…: runtime/seeds.ts reads it). A leaf of its own: a
 *  node-side reader takes it without the runtime (test/instruments-node-load.test.ts), and the boot
 *  never imports it, so the lazy navigation that reaches it through seeds.ts pulls no boot module
 *  (test/runtime-boot-svelte-free.test.ts). */
export const PAGE_SEED_SELECTOR = 'script[type="application/ogygia-page"]';
