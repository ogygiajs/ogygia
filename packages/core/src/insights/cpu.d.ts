/**
 * The main thread, from the browser's own sampler (the JS Self-Profiling API; runtime/beacon.ts keeps
 * the trace in the page on a devtools build). Pure: a trace + the islands' hydrate windows in, out:
 * busy time by kind of code (the app, ogygia, Svelte, packages, a page script, the browser itself),
 * the functions and files that ran, the CPU inside each island's hydrate window and what it was,
 * and what ran in long tasks outside any island. The Page tab shows it; the findings quote it.
 *
 * The trace's timestamps share `performance.now()`'s clock, so the windows line up with the
 * beacon's island timings without conversion.
 */
export interface SelfProfileTrace {
    frames: {
        name?: string;
        resourceId?: number;
        line?: number;
        column?: number;
    }[];
    resources: string[];
    samples: {
        timestamp: number;
        stackId?: number;
    }[];
    stacks: {
        frameId: number;
        parentId?: number;
    }[];
}
export type CodeKind = 'app' | 'ogygia' | 'svelte' | 'dependency' | 'page script' | 'browser' | 'devtools';
export interface CpuFn {
    name: string;
    file: string;
    line: number | null;
    kind: CodeKind;
    self_ms: number;
    total_ms: number;
}
export interface CpuSummary {
    /** sampled span (first to last sample) */
    window_ms: number;
    busy_ms: number;
    by_kind: {
        kind: CodeKind;
        ms: number;
    }[];
    fns: CpuFn[];
    files: {
        file: string;
        kind: CodeKind;
        ms: number;
    }[];
    /** per island fingerprint: CPU inside its hydrate window and the functions that took it */
    islands: Record<string, {
        ms: number;
        top: CpuFn[];
    }>;
    /** long tasks outside every island's hydrate window */
    outside: {
        ms: number;
        top: CpuFn[];
    };
    /** the sampling interval seen (ms) */
    interval_ms: number;
    /** main-thread ms per other origin (the nearest frame with a script URL decides) */
    by_host?: Record<string, number>;
}
export interface IslandWindow {
    fp: string;
    from: number;
    to: number;
}
/** A frame's script, readable: origin, Vite's `/@fs` / `/@id/` prefixes and `?v=` queries off. */
export declare function clean_file(url: string, page_origin?: string): string;
/** What kind of code a frame is, from its script URL (and name, for the browser's own). */
export declare function kind_of(url: string, page_url: string): CodeKind;
export declare function analyze_cpu(trace: SelfProfileTrace, windows: IslandWindow[], longtasks: {
    t: number;
    ms: number;
}[], page_url: string): CpuSummary;
/** `name (file:line)` for a finding. */
export declare function fn_label(f: CpuFn): string;
/** Is this a trace the analyzer can read. */
export declare function is_trace(x: unknown): x is SelfProfileTrace;
