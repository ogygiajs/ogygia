/**
 * The autopilot's reporter (src/autopilot.ts): every test's result, and the failure sites each test's
 * probes hit (src/autopilot-setup.ts), written as one JSON file to `OGYGIA_AUTOPILOT_OUT` when the
 * run ends.
 */
import { writeFileSync } from 'node:fs';
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

/** What a run wrote. */
export interface RunFile {
	readonly tests: RanTest[];
	readonly hits: { readonly test: string; readonly hits: readonly string[] }[];
}

export default class AutopilotReporter implements Reporter {
	readonly #run: RunFile = { tests: [], hits: [] };

	onUserConsoleLog(log: UserConsoleLog): void {
		for (const line of log.content.split('\n')) {
			if (!line.startsWith('{"ogygia_autopilot":')) continue;
			const said = JSON.parse(line) as {
				ogygia_autopilot: { test: string; hits: string[] };
			};
			this.#run.hits.push(said.ogygia_autopilot);
		}
	}

	onTestCaseResult(t: TestCase): void {
		this.#run.tests.push({
			id: t.id,
			file: t.module.moduleId,
			name: t.name,
			full: t.fullName,
			project: t.project.name,
			state: t.result().state
		});
	}

	onTestRunEnd(): void {
		const out = process.env.OGYGIA_AUTOPILOT_OUT;
		if (out) writeFileSync(out, JSON.stringify(this.#run));
	}
}
