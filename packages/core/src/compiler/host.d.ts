/** Directory entry (a `readdirSync(dir, { withFileTypes: true })` element). */
export interface HostDirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
}
/** File stats (`statSync`) — only the members the compiler reads. */
export interface HostStats {
    isDirectory(): boolean;
    isFile(): boolean;
    mtimeMs?: number;
    size?: number;
}
/** The filesystem surface the compiler uses. Reads must be real (the driver resolves the module graph
 *  through them); writes are the build's on-disk emits — a browser host keeps them in memory or no-ops. */
export interface HostFs {
    /** `enc`: the text encoding (the compiler always reads `'utf8'`) */
    readFileSync(p: string, enc?: string): string;
    existsSync(p: string): boolean;
    /** names (`string`s) normally, {@link HostDirent}s with `{ withFileTypes: true }`: read entries
     *  through {@link dir_entries}, which says which */
    readdirSync(p: string, opts?: {
        withFileTypes?: boolean;
    }): unknown[];
    statSync(p: string): HostStats;
    globSync(pattern: string | string[], opts?: Record<string, unknown>): string[];
    writeFileSync(p: string, data: string): void;
    mkdirSync(p: string, opts?: {
        recursive?: boolean;
    }): void;
    rmSync(p: string, opts?: {
        recursive?: boolean;
        force?: boolean;
    }): void;
    renameSync(from: string, to: string): void;
}
/** The `path` surface (node's `path` and `path`-browserify both satisfy this). */
export type HostPath = typeof import('node:path');
/** The one hash the compiler needs — `createHash(algo).update(s).digest('hex')` (md5 ids, sha256 hashes). */
export interface HostHasher {
    update(data: string): HostHasher;
    digest(enc: 'hex'): string;
}
export interface HostCrypto {
    createHash(algo: string): HostHasher;
}
/** A complete host environment. Install one in a non-Node realm via {@link set_host}. */
export interface CompilerHost {
    fs: HostFs;
    path: HostPath;
    crypto: HostCrypto;
}
/**
 * Install a browser (or test) host. No-arg resets to the Node default. Call once, before the first
 * compile: the browser worker builds a virtual host over its workspace file-map and installs it here.
 */
export declare function set_host(h?: CompilerHost): void;
/** The current host's `fs` — read `fs.readFileSync(…)` exactly as with `node:fs`. */
export declare const fs: HostFs;
/** The entries of `dir` on the current host (`readdirSync(dir, { withFileTypes: true })`). */
export declare function dir_entries(dir: string): HostDirent[];
/** The current host's `path` — `path.join(…)` / `path.sep` exactly as with `node:path`. */
export declare const path: HostPath;
/** The current host's `createHash` — `createHash('md5').update(s).digest('hex')`. */
export declare function createHash(algo: string): HostHasher;
