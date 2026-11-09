/**
 * What a recorded session (devtools/session.ts) says — pure, so it tests on plain data. Findings point back
 * at the page: an interaction's target, a shift's element, an island (the tab resolves the refs).
 * The CPU trace, when there is one, names the function behind a slow interaction or a long task
 * (cpu.ts, with each interaction as its own window); long animation frames name the script when
 * the sampler could not run.
 */
import { type CpuSummary } from './cpu.ts';
import type { SessionData } from './session-data.ts';
export type Ref = {
    kind: 'interaction';
    i: number;
} | {
    kind: 'click';
    i: number;
} | {
    kind: 'shift';
    i: number;
} | {
    kind: 'island';
    fp: string;
};
export interface SessionFinding {
    code: string;
    severity: 'error' | 'warn' | 'info';
    message: string;
    fix?: string;
    refs: Ref[];
    /** a same-origin GET the tab can profile on the server in one click (server-time findings) */
    url?: string;
}
/** One island's part of the session: what was done to it, and what it asked the server. */
export interface IslandSession {
    clicks: number;
    /** its interactions over 100 ms */
    slow: {
        target: string;
        duration: number;
        processing: number;
    }[];
    /** requests that started within 3 s after a click on it, with the server's split */
    requests: {
        url: string;
        ms: number;
        server_ms: number | null;
        net_ms: number | null;
        up: string | null;
        status: number | null;
    }[];
    mutations: number;
}
/** One item on the session's one-clock timeline (ms from the session start). */
export interface TimelineItem {
    t0: number;
    t1: number;
    label: string;
    tone: 'ok' | 'warn' | 'bad' | 'info';
    /** a request: the server's part and, inside it, the upstream wait (ms) */
    server?: {
        ms: number;
        up: number;
    };
    ref?: Ref;
}
export interface TimelineLane {
    key: 'input' | 'main' | 'net' | 'islands' | 'layout' | 'errors';
    label: string;
    items: TimelineItem[];
}
/** The session on one clock, lane by lane (the Record tab draws it). Capped per lane. */
export declare function session_timeline(s: SessionData, names: (fp: string) => string): TimelineLane[];
export interface SessionReport {
    duration_ms: number;
    /** `shifts` and `cls`: the layout moving with no input (the shifts the session's CLS counts) */
    counts: {
        interactions: number;
        slow: number;
        longtasks: number;
        longtask_ms: number;
        requests: number;
        request_bytes: number;
        errors: number;
        shifts: number;
        cls: number;
        mutations: number;
        pages: number;
    };
    findings: SessionFinding[];
    /** the slowest interactions, for the timeline */
    interactions: {
        i: number;
        t: number;
        name: string;
        duration: number;
        target: string;
        fp: string | null;
    }[];
    /** each island's part: clicks, slow interactions, the requests its clicks caused (server split) */
    by_island: Record<string, IslandSession>;
    /** the slowest requests, with the server's own split when it sent one */
    requests: {
        url: string;
        ms: number;
        status: number | null;
        server_ms: number | null;
        cpu_ms: number | null;
        net_ms: number | null;
        up: string | null;
    }[];
    /** every request that answered an error status (`type`: the browser's initiator type) */
    failed: {
        url: string;
        status: number;
        type: string;
        t: number;
    }[];
    /** the slowest interaction on each element the session touched, however quick (0: a click the
     *  browser did not time, under its 16 ms floor) */
    by_element: {
        target: string;
        duration: number;
        processing: number;
        t: number;
        fp: string | null;
    }[];
    cpu: CpuSummary | null;
}
export declare function analyze_session(s: SessionData, names: (fp: string) => string, page_url: string): SessionReport;
