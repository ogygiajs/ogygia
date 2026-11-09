export declare class SizedLru<V> {
    #private;
    readonly max_bytes: number;
    readonly max_entries: number;
    constructor(max_bytes: number, max_entries: number);
    /** The live value for `key` (an LRU touch), or `null` on a miss or past `expires`. */
    get(key: string, now: number): V | null;
    has(key: string): boolean;
    /** Store `value` (`bytes` big, live until `expires`), evicting the least recently used entries
     *  to make room. A value larger than the whole budget is not stored. */
    set(key: string, value: V, bytes: number, expires: number): void;
    delete(key: string): boolean;
    /** Every live key (insertion order — least recently used first). */
    keys(): IterableIterator<string>;
    /** Drop everything past `expires` (harness counts want live entries only). */
    sweep(now: number): void;
    clear(): void;
    get size(): number;
    get bytes(): number;
}
