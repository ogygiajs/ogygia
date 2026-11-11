import { afterEach, describe, expect, it, vi } from 'vitest';
import { request_scope } from '@ogygia/core/internal/server';
import { ofrep } from '../src/ofrep.ts';
import { openfeature } from '../src/openfeature.ts';
import type { FlagQuery } from '../src/index.ts';

const ctx = () => ({ request: new Request('http://s/x'), url: new URL('http://s/x') });
const BOOL: FlagQuery = { name: 'kill', variants: ['off', 'on'], kind: 'boolean' };
const VARIANT: FlagQuery = { name: 'hero', variants: ['control', 'bold'], kind: 'variant' };

afterEach(() => vi.restoreAllMocks());

describe('ofrep()', () => {
	it('reads a boolean value as the on or off variant', async () => {
		const source = ofrep({
			url: 'http://flags.test',
			fetch: (async () =>
				Response.json({
					flags: [
						{ key: 'kill', value: true },
						{ key: 'hero', variant: 'bold' }
					]
				})) as typeof fetch
		});
		expect(await source([BOOL, VARIANT], ctx())).toEqual({ kill: 'on', hero: 'bold' });
	});

	it('throws on an error answer with a JSON body, so the flags fall to their native rule and it is said', async () => {
		const source = ofrep({
			url: 'http://flags.test',
			fetch: (async () => Response.json({ errorCode: 'GENERAL' }, { status: 503 })) as typeof fetch
		});
		await expect(source([BOOL], ctx())).rejects.toThrow('answered 503');
	});

	it('gives up after 800 ms by default', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		const source = ofrep({
			url: 'http://flags.test',
			fetch: (async () => Response.json({ flags: [] })) as typeof fetch
		});
		await source([BOOL], ctx());
		expect(timeout).toHaveBeenCalledWith(800);
	});

	it('stops asking when the request ends first, and reports no failure', async () => {
		const c = ctx();
		let aborted = false;
		const source = ofrep({
			url: 'http://flags.test',
			timeout: 60_000,
			fetch: ((_u: string, init: RequestInit) =>
				new Promise((_resolve, reject) => {
					init.signal!.addEventListener('abort', () => {
						aborted = true;
						reject(init.signal!.reason);
					});
				})) as unknown as typeof fetch
		});
		const answer = source([BOOL], c);
		request_scope(c.request).close();
		expect(await answer).toEqual({});
		expect(aborted).toBe(true);
	});
});

describe('openfeature()', () => {
	it('asks with off as the default for a boolean flag and the first variant for a variant flag', async () => {
		const defaults: unknown[] = [];
		const source = openfeature({
			async getBooleanValue(_k: string, d: boolean) {
				defaults.push(d);
				return d;
			},
			async getStringValue(_k: string, d: string) {
				defaults.push(d);
				return d;
			}
		});
		expect(await source([BOOL, VARIANT], ctx())).toEqual({ kill: 'off', hero: 'control' });
		expect(defaults).toEqual([false, 'control']);
	});
});
