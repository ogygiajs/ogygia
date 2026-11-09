import type { ClientPlugin } from '../plugin/client.ts';
/**
 * Parse a fetched region's HTML into a fragment, HOISTING any `<link data-ogygia-region-css>` (or
 * inlined `<style data-ogygia-region-css="href">`) it carries into `<head>` (deduped by href). A held / server-picked region's component was never
 * imported by the page, so its scoped CSS is in no stylesheet the page loaded; the region response
 * ships the links and the runtime lifts them to the head — where they load once and stick. (A link
 * left in the body would also fail to load inside a `<template>` batch parcel.) `sheets`: the head
 * nodes the answer uses, for the region that paints it (./region-sheets.ts `use_sheets`).
 */
export declare function region_fragment(html: string): {
    frag: DocumentFragment;
    ready: Promise<void>;
    sheets: readonly Element[];
};
/** TEST: the pristine server markup {@link region_fragment} stashed on a nested island, if any. */
export declare function pristine_ssr_of(el: Element): string | undefined;
export declare function boot(installers?: Array<() => void>, client_plugins?: readonly ClientPlugin[]): void;
