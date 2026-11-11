// Run by test/e2e-check.test.ts through Playwright: two failing checks and one passing, then a line.
import { appendFileSync } from 'node:fs';
import { check, test } from '../../../src/e2e/index.ts';

test('three checks', () => {
	check('first fails', false, 'measured 3');
	check('second passes', true);
	check('third fails', 0);
	appendFileSync(process.env.CHECKS_TRAIL!, 'reached the end\n');
});
