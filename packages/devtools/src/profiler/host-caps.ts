import { say } from '@ogygia/machine';
import { line, warn } from '../messages/runtime.ts';

const CODE = 'devtools_profiler_runtime_unsupported';

const told = say({ max: 4 });

/** A recording this runtime cannot make; its message is the code's line. */
export class CannotRecord extends Error {
	readonly code: string = CODE;
}

function cpu_works(): boolean {
	try {
		const c = process.cpuUsage();
		return typeof c?.user === 'number';
		// oxlint-disable-next-line ogygia/no-silent-failures -- the gap is said by the caller (devtools_profiler_runtime_unsupported)
	} catch {
		return false;
	}
}

async function recording_gap(): Promise<string | null> {
	try {
		const { Session } = await import('node:inspector/promises');
		if (typeof Session !== 'function') return 'node:inspector';
		// oxlint-disable-next-line ogygia/no-silent-failures -- the gap is said by the caller (devtools_profiler_runtime_unsupported)
	} catch {
		return 'node:inspector';
	}
	try {
		const perf_hooks = await import('node:perf_hooks');
		perf_hooks.monitorEventLoopDelay({ resolution: 10 }).disable();
		perf_hooks.performance.eventLoopUtilization();
		// oxlint-disable-next-line ogygia/no-silent-failures -- the gap is said by the caller (devtools_profiler_runtime_unsupported)
	} catch {
		return 'perf_hooks';
	}
	return null;
}

/**
 * What this runtime lets the profiler measure, checked once: Node's `process.cpuUsage` (a request's
 * CPU time) and what a recording needs (`node:inspector`, `perf_hooks`). A runtime without them
 * still has every request answered and logged, without CPU time, and refuses recordings; each gap
 * is said once per process (`devtools_profiler_runtime_unsupported`).
 */
export class HostCaps {
	/** `process.cpuUsage` works here. */
	readonly cpu: boolean = cpu_works();

	#recording: Promise<string | null> | null = null;

	#tell(lacks: string): void {
		told.once(lacks, () => warn(CODE, { lacks, off: off_for(lacks) }));
	}

	#gap(): Promise<string | null> {
		return (this.#recording ??= this.cpu ? recording_gap() : Promise.resolve('process.cpuUsage'));
	}

	/** The CPU clock now, the start a later `cpu_ms_since` reads from; null without one (a gap
	 *  said once). */
	cpu_now(): NodeJS.CpuUsage | null {
		if (this.cpu) return process.cpuUsage();
		this.#tell('process.cpuUsage');
		return null;
	}

	/** CPU ms the process used since `start`; undefined without a CPU clock. */
	cpu_ms_since(start: NodeJS.CpuUsage | null): number | undefined {
		if (start === null) return undefined;
		const c = process.cpuUsage(start);
		return (c.user + c.system) / 1000;
	}

	/** True when this runtime can make a recording (checked once; a gap is said once). */
	async can_record(): Promise<boolean> {
		const lacks = await this.#gap();
		if (lacks === null) return true;
		this.#tell(lacks);
		return false;
	}

	/** Throws `CannotRecord` unless this runtime can make a recording. */
	async must_record(): Promise<void> {
		const lacks = await this.#gap();
		if (lacks === null) return;
		this.#tell(lacks);
		throw new CannotRecord(line(CODE, { lacks, off: off_for(lacks) }));
	}
}

function off_for(lacks: string): string {
	return lacks === 'process.cpuUsage'
		? 'requests are logged without CPU time, and recordings are refused'
		: 'recordings are refused';
}
