import { expect, it } from 'vitest';
import { scope, stage, STALE } from '../src/index.ts';

it('a commit asked for while the owner closes (from the build’s abort) is refused, and the build is given back', async () => {
	const owner = scope();
	const log: string[] = [];
	let signal!: AbortSignal;
	const next = stage(owner, {
		build: (s) => {
			signal = s.signal;
			s.discard(() => void log.push('given back'));
			return 'page';
		},
		commit: () => void log.push('committed')
	});
	expect(await next.ready).not.toBe(STALE);
	// a built stage, and the owner closing: the build's signal aborts before the stage's own
	// cleanup has discarded it, so the stage is still `built` when the listener asks to commit
	signal.addEventListener('abort', () => void log.push(`commit: ${next.commit()}`));
	owner.close();
	expect(log).toEqual(['commit: false', 'given back']);
	expect(next.commit()).toBe(false);
});
