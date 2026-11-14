export function code_fn(...params_and_body: string[]): (...args: unknown[]) => unknown {
	// oxlint-disable-next-line typescript/no-implied-eval -- these suites run the code the compiler generated
	return new Function(...params_and_body) as (...args: unknown[]) => unknown;
}
