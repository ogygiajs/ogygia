/**
 * The autopilot's reporter (src/autopilot.ts): each test's result and the failure sites each test's
 * probes hit (src/autopilot-setup.ts), one JSON line each, appended to `OGYGIA_AUTOPILOT_OUT` as they
 * come. A run the autopilot stops past its time limit tells nothing about which test hung (a worker
 * stuck in a loop reports nothing, and one killed fails the tests it held): the autopilot then runs
 * each test alone.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import type { Reporter, TestCase } from 'vitest/node';

type UserConsoleLog = Parameters<NonNullable<Reporter['onUserConsoleLog']>>[0];

/** One test's result in a run. */
export interface RanTest {
	readonly id: string;
	/** Its file, absolute. */
	readonly file: string;
	readonly name: string;
	readonly full: string;
	readonly project: string;
	readonly state: string;
}

/** One line the reporter writes. */
export type RunEvent =
	| { readonly result: RanTest }
	| { readonly hits: { readonly test: string; readonly hits: readonly string[] } };

/** What a run wrote, read back: the results and the hits. */
export interface RunFile {
	readonly tests: RanTest[];
	readonly hits: { readonly test: string; readonly hits: readonly string[] }[];
}

/** The run `lines` (the reporter's file) tell. */
export function read_run(lines: string): RunFile {
	const run: RunFile = { tests: [], hits: [] };
	for (const line of lines.split('\n')) {
		if (!line.trim()) continue;
		const e = JSON.parse(line) as RunEvent;
		if ('result' in e) run.tests.push(e.result);
		else run.hits.push(e.hits);
	}
	return run;
}

function write(e: RunEvent): void {
	const out = process.env.OGYGIA_AUTOPILOT_OUT;
	if (out) appendFileSync(out, `${JSON.stringify(e)}\n`);
}

export default class AutopilotReporter implements Reporter {
	onUserConsoleLog(log: UserConsoleLog): void {
		for (const line of log.content.split('\n')) {
			if (!line.startsWith('{"ogygia_autopilot":')) continue;
			const said = JSON.parse(line) as {
				ogygia_autopilot: { test: string; hits: string[] };
			};
			write({ hits: said.ogygia_autopilot });
		}
	}

	onInit(): void {
		const out = process.env.OGYGIA_AUTOPILOT_OUT;
		if (out) writeFileSync(out, '');
	}

	onTestCaseResult(t: TestCase): void {
		write({
			result: {
				id: t.id,
				file: t.module.moduleId,
				name: t.name,
				full: t.fullName,
				project: t.project.name,
				state: t.result().state
			}
		});
	}
}
