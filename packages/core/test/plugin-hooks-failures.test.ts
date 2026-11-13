// SHARED HOOKS THAT FAIL (plugin/hooks.ts). One implementation failing never stops the others: a
// notify runs them all and then rejects with what failed ("done" and "done, but one could not" are
// different answers), an ask goes on to the next and throws only when nobody answered, and a
// `codeOrigins` that throws adds none. Each failure is said with its code.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ask, code_origins, notify, register_hooks } from '../src/plugin/hooks.ts';

let leave: (() => void)[] = [];
let said: string[] = [];
beforeEach(() => {
	said = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void said.push(a.join(' ')));
	vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void said.push(a.join(' ')));
});
afterEach(() => {
	for (const l of leave) l();
	leave = [];
	vi.restoreAllMocks();
});
const join = (impl: object) => void leave.push(register_hooks(impl));

it('a notify runs every implementation past one that fails, then rejects with its error', async () => {
	const ran: string[] = [];
	join({
		invalidate() {
			ran.push('first');
			throw new Error('a store that is down');
		}
	});
	join({ invalidate: () => void ran.push('second') });
	await expect(notify.invalidate(['t'])).rejects.toThrow('a store that is down');
	expect(ran).toEqual(['first', 'second']);
	expect(said.some((s) => s.includes('plugin_hook_failed'))).toBe(true);
});

it('an ask goes past an implementation that fails to the next one’s answer', async () => {
	join({
		lastBuild() {
			throw new Error('a store that is down');
		}
	});
	join({ lastBuild: () => 'v1' });
	await expect(ask.lastBuild('v2')).resolves.toBe('v1');
});

it('an ask nobody answered, one having failed, throws that failure: never "nobody knows"', async () => {
	join({
		lastBuild() {
			throw new Error('a store that is down');
		}
	});
	join({ lastBuild: () => undefined });
	await expect(ask.lastBuild('v2')).rejects.toThrow('a store that is down');
});

it('a codeOrigins that throws adds none, the others’ count, and the failure is said', () => {
	join({
		codeOrigins() {
			throw new Error('a list it could not read');
		}
	});
	join({ codeOrigins: () => ['https://peer.example'] });
	expect(code_origins()).toEqual(['https://peer.example']);
	expect(said.some((s) => s.includes('plugin_hook_failed'))).toBe(true);
});
