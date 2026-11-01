// LAYOUT → PAGE MERGE proof: this layout turns postrender off for its whole subtree, in Kit's own
// `config`. Kit merges a layout's config into every page below it, and so does the build that reads
// it: /quiet inherits `false` (never stored); /quiet/loud sets `true` itself and wins (stored).
export const config = { postrender: false };
