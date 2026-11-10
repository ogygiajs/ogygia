/**
 * The script an answer carries with the page facts it rendered with (server/render-page.ts writes it,
 * the runtime's answer seam `region_fragment` takes it out, seeds.ts merges it). Isomorphic: both
 * halves name it from here.
 */
export const PAGE_FACTS_SCRIPT_TYPE = 'application/ogygia-page-facts';
export const PAGE_FACTS_SELECTOR: `script[type="${typeof PAGE_FACTS_SCRIPT_TYPE}"]` = `script[type="${PAGE_FACTS_SCRIPT_TYPE}"]`;
/** The page's own seed (`page.data`, url, params…: runtime/seeds.ts reads it). Here, a leaf, so a
 *  node-side reader takes the selector without the runtime (test/instruments-node-load.test.ts). */
export const PAGE_SEED_SELECTOR = 'script[type="application/ogygia-page"]';
