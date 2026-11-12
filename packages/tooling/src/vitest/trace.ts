/**
 * The machine moves of a Vitest test, printed when it fails: what the runtime's machines did, one
 * line per move (`visit#3 loading -> answered`), so a failure in a browser test says how the page
 * got there. A browser project lists `@ogygia/tooling/vitest/trace-setup` in its `setupFiles`.
 *
 * @packageDocumentation
 */
import { trace, type TraceOptions } from '@ogygia/machine';

/** What {@link trace_on_failure} needs of a test's context: Vitest's own. */
export interface FailureContext {
	task: { name: string };
	onTestFailed: (handler: () => void) => void;
}

/**
 * Records every machine move from now until the test ends, and prints them (`print`, default
 * `console.error`) if it fails. Returns the stop, for a `beforeEach` to hand back as its teardown.
 */
export function trace_on_failure(
	context: FailureContext,
	print: (text: string) => void = console.error,
	options?: TraceOptions
): () => void {
	const moves = trace(options);
	context.onTestFailed(() => {
		const text = moves.text();
		print(
			text
				? `machine moves in "${context.task.name}":\n${text}`
				: `no machine moved in "${context.task.name}"`
		);
	});
	return () => moves.stop();
}
