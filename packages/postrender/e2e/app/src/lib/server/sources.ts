// The og.source() fixture: a DECLARED data source (the postrender reverse index). Every page
// whose render calls `read_doc('promo')` files a receipt; `postrender.invalidate(read_doc,
// ['promo'])` then evicts exactly those pages — at origin AND every edge — however many and
// wherever they are. No strings, no URL lists.
import { cms_read } from './state.js';

export const read_doc = import.meta.og.source((slug: string) => cms_read(slug));
