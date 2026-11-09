export declare const base = "";
export declare const assets = "";
/** Base-prefix a pathname, or populate a route id's dynamic segments. */
export declare function resolve(id: string, params?: Record<string, string>): string;
/** Resolve an asset URL in the static dir — `'x'` (Kit 3's form) or `'/x'` (Kit 2's). */
export declare function asset(file: string): string;
