import { afterEach, describe, expect, it, vi } from 'vitest';
import { scope, stage, STALE } from '../src/index.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
	vi.restoreAllMocks();
});

/** A live value and the changes a stage makes to it, in order. */
function live() {
	const log: string[] = [];
	return { log, value: 'old' };
}

describe('build and commit', () => {
	it('builds off to the side, then switches in at once', async () => {
		const owner = scope();
		const page = live();
		const next = stage(owner, {
			build: async () => {
				await wait(10);
				return 'new';
			},
			commit: (built) => {
				page.value = built;
			}
		});
		expect(next.commit()).toBe(false); // (not built yet)
		expect(page.value).toBe('old');
		expect(await next.ready).toBe('new');
		expect(page.value).toBe('old');
		expect(next.commit()).toBe(true);
		expect(page.value).toBe('new');
		expect(next.commit()).toBe(false); // once
	});

	it('a commit after the owner closed is refused, and the build is given back', async () => {
		const owner = scope();
		const page = live();
		const next = stage(owner, {
			build: ({ discard }) => {
				page.log.push('preloaded');
				discard(() => page.log.push('dropped'));
				return 'new';
			},
			commit: (built) => {
				page.value = built;
			}
		});
		await next.ready;
		owner.close();
		expect(next.commit()).toBe(false);
		expect(page.value).toBe('old');
		expect(page.log).toEqual(['preloaded', 'dropped']);
	});

	it('a committed stage gives nothing back when its owner closes', async () => {
		const owner = scope();
		const page = live();
		const next = stage(owner, {
			build: ({ discard }) => {
				discard(() => page.log.push('dropped'));
				return 'new';
			},
			commit: (built) => {
				page.value = built;
			}
		});
		await next.ready;
		expect(next.commit()).toBe(true);
		owner.close();
		expect(page.value).toBe('new');
		expect(page.log).toEqual([]);
	});
});

describe('an owner that closes first', () => {
	it('ready is STALE at once, and what the build made so far is given back', async () => {
		const owner = scope();
		const page = live();
		let release!: () => void;
		const next = stage(owner, {
			build: async ({ discard }) => {
				page.log.push('a');
				discard(() => page.log.push('drop a'));
				await new Promise<void>((r) => (release = r));
				page.log.push('b');
				discard(() => page.log.push('drop b'));
				return 'new';
			},
			commit: (built) => {
				page.value = built;
			}
		});
		await wait(0);
		owner.close();
		expect(await next.ready).toBe(STALE);
		expect(page.log).toEqual(['a', 'drop a']);
		// the build lands late: what it makes then is given back at once
		release();
		await wait(0);
		expect(page.log).toEqual(['a', 'drop a', 'b', 'drop b']);
		expect(next.commit()).toBe(false);
		expect(page.value).toBe('old');
	});

	it('the build’s signal aborts when the owner closes', async () => {
		const owner = scope();
		let signal!: AbortSignal;
		const next = stage(owner, {
			build: (s) => {
				signal = s.signal;
				return new Promise<string>(() => {});
			},
			commit: () => {}
		});
		expect(signal.aborted).toBe(false);
		owner.close();
		expect(signal.aborted).toBe(true);
		expect(await next.ready).toBe(STALE);
	});

	it('an owner already closed never builds', async () => {
		const owner = scope();
		owner.close();
		const build = vi.fn(() => 'new');
		const next = stage(owner, { build, commit: () => {} });
		expect(await next.ready).toBe(STALE);
		expect(build).not.toHaveBeenCalled();
		expect(next.commit()).toBe(false);
	});
});

describe('failures', () => {
	it('a commit that throws puts back what it changed, gives back the build, and throws', async () => {
		const owner = scope();
		const page = live();
		const next = stage(owner, {
			build: ({ discard }) => {
				discard(() => page.log.push('dropped'));
				return 'new';
			},
			commit: (built, undo) => {
				const was = page.value;
				page.value = built;
				undo(() => {
					page.value = was;
					page.log.push('undone');
				});
				throw new Error('half way');
			}
		});
		await next.ready;
		expect(() => next.commit()).toThrow('half way');
		expect(page.value).toBe('old');
		expect(page.log).toEqual(['undone', 'dropped']);
		expect(next.commit()).toBe(false);
	});

	it('a build that throws gives back what it made, and ready rejects', async () => {
		const owner = scope();
		const page = live();
		const next = stage(owner, {
			build: async ({ discard }) => {
				discard(() => page.log.push('dropped'));
				await wait(0);
				throw new Error('no page');
			},
			commit: () => {}
		});
		await expect(next.ready).rejects.toThrow('no page');
		expect(page.log).toEqual(['dropped']);
		expect(next.commit()).toBe(false);
	});

	it('a step that throws is said once, and the others still run', async () => {
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
		const owner = scope();
		const page = live();
		const next = stage(owner, {
			name: 'navigation',
			build: ({ discard }) => {
				discard(() => page.log.push('first'));
				discard(() => {
					throw new Error('stuck');
				});
				return 'new';
			},
			commit: () => {}
		});
		await next.ready;
		expect(() => owner.close()).not.toThrow();
		expect(page.log).toEqual(['first']);
		expect(said).toHaveBeenCalledTimes(1);
		expect(String(said.mock.calls[0][0])).toContain('machine_stage_step_failed');
		expect(String(said.mock.calls[0][0])).toContain('navigation');
	});

	it('refuses a build or commit that is not a function', () => {
		expect(() => stage(scope(), { build: 1 as never, commit: () => {} })).toThrow(
			/machine_bad_option/
		);
		expect(() => stage(scope(), { build: () => 1, commit: null as never })).toThrow(
			/machine_bad_option/
		);
	});
});
