/**
 * Which files held the first paint. Chromium says it per file (`renderBlockingStatus`); Safari and
 * Firefox say nothing, and every paint finding (render-blocking, the first paint's parts, a slow
 * first paint's "waiting for") went silent there. For those, the files the document's head makes
 * blocking — what the browser itself waits on: a stylesheet whose media applies, a classic script
 * with neither async nor defer, anything marked `blocking="render"` — read off the elements the
 * parser met, which started before the document was parsed (a stylesheet a script added later
 * never held the first paint).
 */
/** `(r) => did r hold the first paint`, read once for a pass over many entries */
export declare function paint_blocker(): (r: PerformanceResourceTiming) => boolean;
