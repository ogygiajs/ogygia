/**
 * THIRD PARTIES — what other origins cost this page, from what the browser measured: their files and
 * bytes (resource timing), the ones that held the first paint, the scripts that loaded more scripts
 * at runtime (a tag manager's shape), and their main-thread time when there is a CPU trace. Pure, so
 * the devtools Page tab and the profiler report run the same analysis on the same visit.
 *
 * Detection is by behavior (another origin; blocking; CPU; a script whose arrival is followed by
 * scripts nothing in the page names). The host table only puts a readable label on well-known
 * public services — a host it does not know is still measured, as "other".
 */
export type ThirdPartyKind = 'tag manager' | 'analytics' | 'ads' | 'session replay' | 'chat' | 'a/b testing' | 'consent' | 'fonts' | 'library cdn' | 'other';
export declare function kind_of_host(host: string): ThirdPartyKind;
export interface ThirdPartyOrigin {
    host: string;
    kind: ThirdPartyKind;
    files: number;
    scripts: number;
    /** decoded bytes of its scripts */
    script_bytes: number;
    /** its scripts the browser gave no size for (some engines hide every other origin's sizes,
     *  even with Timing-Allow-Origin): `script_bytes` leaves them out */
    unsized: number;
    /** every byte on the wire */
    wire: number;
    /** files that held the first paint */
    blocking: number;
    /** when its first file started (ms from navigation) */
    first: number;
    /** main-thread ms in its scripts (a CPU trace), else null */
    cpu_ms: number | null;
}
export interface ThirdParty {
    origins: ThirdPartyOrigin[];
    script_bytes: number;
    unsized: number;
    /** scripts whose size the browser hid and that were weighed apart from the visit */
    weighed: number;
    wire: number;
    blocking: number;
    cpu_ms: number | null;
    /** third-party scripts that started after another third-party script arrived and that no
     *  document ref names: loaded at runtime (by a tag manager, a loader) */
    runtime_loaded: number;
}
interface Res {
    url: string;
    type: string;
    start: number;
    end: number;
    transfer?: number;
    size?: number;
    blocking?: boolean;
    /** a size the browser hid, weighed apart from the visit */
    weighed?: true;
}
/** `named`: URLs the server's HTML references (its scripts, preloads, their imports) — another
 *  origin's script not among them came at runtime. Without it (the live page already holds the
 *  injected script elements), `parsed`: when the HTML was parsed (domInteractive) — a script that
 *  starts after that and after another origin's script ran was loaded by a script. `in_page`: the
 *  URLs the live document holds — a script no element names came by an import or a fetch (a
 *  self-loading library's parts), whenever it started. */
export declare function third_party(resources: readonly Res[], page_origin: string, cpu_by_host: ReadonlyMap<string, number> | null, named?: ReadonlySet<string>, parsed?: number, in_page?: ReadonlySet<string>): ThirdParty | null;
export interface ThirdPartyFinding {
    code: string;
    severity: 'warn' | 'info';
    message: string;
    fix?: string;
}
/** `edited`: islands that did not wake from the server's markup on this visit (changed, recovered,
 *  healed, failed), with when they woke (ms; Infinity when unknown or never). */
export declare function third_party_findings(tp: ThirdParty | null, edited?: readonly {
    name: string;
    done: number;
}[]): ThirdPartyFinding[];
export {};
