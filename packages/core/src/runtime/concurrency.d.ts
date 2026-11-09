export interface GateOptions {
    /** The call answers within this long: the wait for a slot and the run together. */
    deadline_ms?: number;
    /** Nobody waits on the call any more once it aborts (a batch whose visitor left, #245): still
     *  waiting, it leaves the queue at once and its body never runs (the call rejects with the
     *  signal's reason); already running, it runs on (a body cannot be cancelled). */
    signal?: AbortSignal;
}
export declare class ConcurrencyGate {
    #private;
    constructor(max: number);
    run<T>(fn: () => Promise<T>, options?: GateOptions): Promise<T>;
    /** Bodies running that someone waits on (the limit counts these). */
    get active(): number;
    /** Bodies past their deadline still running: nobody waits on them, and they hold no slot. */
    get abandoned(): number;
    /** Calls waiting for a slot. */
    get waiting(): number;
}
/** Whether `error` is a call's run timeout: its body ran past the deadline and was abandoned. */
export declare function is_run_timeout(error: unknown): boolean;
/** Max concurrent region SSR renders per process (CPU amp under valid MAC). */
export declare const REGION_RENDER_CONCURRENCY = 4;
