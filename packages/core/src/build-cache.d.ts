/** Point the cache at a project (the Vite plugin calls this with the app root at config time). */
export declare function configure_build_cache(project_root: string): void;
/** Test hook: force the cache root (or `null` to disable, `undefined` to re-probe). */
export declare function __set_build_cache_root(dir: string | null | undefined): void;
export declare class BuildCache<T> {
    readonly namespace: string;
    constructor(namespace: string);
    /** This namespace's DIRECTORY, for artifact trees the consumer manages itself (git checkouts).
     *  Returns the ensured absolute path, or `null` when the cache is unavailable. */
    dir(): string | null;
    get(key: string): T | null;
    set(key: string, value: T): void;
}
