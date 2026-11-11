/**
 * A Vitest reporter for the tests report (.github/scripts/test-report.ts): each test case, with the
 * project that ran it (`node`, `browser (chromium)`, …), its file and its state, one JSON line each,
 * appended to the file `OGYGIA_TEST_RESULTS` names. Vitest's own JSON reporter does not say which
 * project ran a file, and one file can run in several.
 *
 *   vitest run --reporter=default --reporter=<repo>/.github/scripts/vitest-results.ts
 */
import { appendFileSync } from 'node:fs';
import type { Reporter, TestModule } from 'vitest/node';

export interface CaseLine {
	project: string;
	file: string;
	name: string;
	state: 'passed' | 'failed' | 'skipped' | 'pending';
}

export default class VitestResults implements Reporter {
	onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
		const out = process.env.OGYGIA_TEST_RESULTS;
		if (!out) return;
		const lines: string[] = [];
		for (const module of modules)
			for (const test of module.children.allTests()) {
				const line: CaseLine = {
					project: module.project.name,
					file: module.moduleId,
					name: test.fullName,
					state: test.result().state
				};
				lines.push(JSON.stringify(line));
			}
		if (lines.length) appendFileSync(out, lines.join('\n') + '\n');
	}
}
