/** Add the time since `t0` to `phase`. */
export declare function charge(phase: string, t0: number): void;
/** Run `fn`, charging its time to `phase`. */
export declare function metered<T>(phase: string, fn: () => T): T;
/** The cost so far, rounded: `{ ms, phases }`. */
export declare function own_cost(): {
    ms: number;
    phases: Record<string, number>;
};
