/** The most visit rows a bundled store keeps under one `page` key, newest first. A server window
 *  writes every request it saw (from any instance) under ONE key and reads up to this many back,
 *  so the store's retention and the window's read are the same number. */
export const MAX_VISITS_PER_KEY = 2000;
