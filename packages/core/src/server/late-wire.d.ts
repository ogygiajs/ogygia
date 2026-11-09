/**
 * The LATE WIRE — how a region that resolves after the document flushed reaches the page down the SAME
 * response. A slot (`<og-late-slot>`, also what `<Region of={promise}>` renders around its placeholder)
 * sits in the flushed document; each later state rides down as an inert `<template data-og-late>` chunk
 * that ONE small classic inline script in the head swaps in as it parses. Module scripts don't run until
 * parsing ENDS, which for a streamed document is the very thing we're not waiting for. After an SPA
 * navigation the runtime applies remaining templates itself (runtime/router-nav.ts).
 *
 * A renderer that delivers late chunks (the server router's streamed document) speaks this format; core
 * owns it because core's components emit the slots and core's runtime consumes the chunks.
 */
/** Wrap html as the swappable slot `id` (display:contents — layout-invisible). */
export declare function late_slot(id: string, html: string): string;
/** A late chunk: inert template + nothing else — the boot script (or the runtime, post-SPA-swap)
 *  performs the swap. Multiple chunks for one slot apply in order (progressive states). */
export declare function late_chunk(id: string, html: string): string;
/**
 * The classic inline boot: observes streamed-in `<template data-og-late>` nodes DURING parse and
 * swaps each into its slot immediately (stylesheet links hoist to head first so the swap never
 * paints unstyled). Kept dependency-free and tiny — it must run before any module script can.
 */
export declare const LATE_BOOT_SCRIPT: string;
