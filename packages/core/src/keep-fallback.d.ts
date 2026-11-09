export { KEEP_FALLBACK_HTML } from './keep-fallback-marker.ts';
export declare class KeepFallbackSignal extends Error {
    constructor();
}
/** End this server island's render: the page's fallback is the right content for this visitor.
 *  Called from a server island rendering INLINE (nested in an island — the deferred mark is
 *  ignored there), the signal would escape to Kit's error page: fail with the reason instead. */
export declare function keepFallback(): never;
/** Did a hole render end with {@link keepFallback}? (the handle's catch reads this) */
export declare function is_keep_fallback(e: unknown): boolean;
