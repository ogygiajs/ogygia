// `rule_failure_uncoded` (runtime/rules.ts, #1475): a failure nobody caught is ogygia's when it was
// thrown in ogygia's own code, whatever its message. A plain TypeError out of the runtime has no
// code, so it is broken; the same error thrown by the app's code is the app's.
//
// Its own file: the rules are module state shared by a file's tests.
import { expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { unknown_markers } from '../../src/wire-markup.ts';

type Broken = Array<{ code: string; detail: string }>;
const rules = (): Broken =>
	(globalThis as unknown as { __ogygia_rules: () => Broken }).__ogygia_rules();

const uncaught = (reason: unknown): void => {
	window.dispatchEvent(
		new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason })
	);
};

const thrown = (run: () => unknown): Error => {
	try {
		run();
	} catch (e) {
		return e as Error;
	}
	throw new Error('it did not throw');
};

test("a TypeError the app's own code threw is the app's: no rule is broken", () => {
	bootDev();
	uncaught(thrown(() => (null as unknown as { x: number }).x));
	uncaught(new TypeError('no stack at all'));
	expect(rules()).toEqual([]);
});

test("a TypeError thrown in ogygia's own code, with no code, breaks rule_failure_uncoded", () => {
	const ours = thrown(() => unknown_markers(null as unknown as string[]));
	expect(ours).toBeInstanceOf(TypeError);
	uncaught(ours);
	expect(rules()).toEqual([
		{
			code: 'rule_failure_uncoded',
			detail: expect.stringMatching(/^a TypeError thrown in ogygia's code, with no code: /)
		}
	]);
});
