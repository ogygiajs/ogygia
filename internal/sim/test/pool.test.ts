// A batch's worker processes run with the batch's own options (src/cli.ts).
import { describe, expect, it } from 'vitest';
import { worker_args } from '../src/cli.ts';

describe('a worker of the pool', () => {
	// the pool passed its workers a list of the options it knew of, and `--paths`, `--name` and
	// `--peers` were not on it: a batch's workers never went to the pages it named (a programmatic
	// router's), and a federated batch ran its app alone
	it('gets every option of the batch', () => {
		const batch = ['--paths', '/a,/b', '--app', 'apps/x', '--calm', '--name', 'shell'];
		const args = worker_args(batch);
		expect(args[0]).toBe('--worker');
		expect(args.slice(1)).toEqual(batch);
	});
});
