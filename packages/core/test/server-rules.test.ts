/**
 * THE SERVER'S RULES (#313, src/server/rules.ts): a response read to its end leaves its request's
 * scope closed, and no flight keeps a failure; each broken one is said with its code, a task after
 * the response that broke it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flights, scope } from '@ogygia/machine';
import { install_server_rules, note_response_end, server_rules } from '../src/server/rules.ts';
import { own_response } from '../src/plugin/request-scope.ts';

install_server_rules();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
afterEach(() => vi.restoreAllMocks());

describe('server rules', () => {
	it('a streamed response read to its end: its scope is closed, no rule broken', async () => {
		const owner = scope();
		const request = new Request('https://app.test/');
		const out = own_response(owner, new Response('<p>page</p>'), request);
		expect(await out.text()).toBe('<p>page</p>');
		await tick();
		expect(owner.closed).toBe(true);
		expect(server_rules.broken()).toEqual([]);
	});

	it('a response that ended with its scope still open is said, with its code', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const owner = scope();
		note_response_end(owner);
		await tick(5);
		expect(server_rules.broken()).toEqual([
			{
				code: 'rule_request_scope_open',
				detail: '1 request scope(s) still open after their response ended'
			}
		]);
		expect(warn.mock.calls.some((c) => String(c[0]).includes('rule_request_scope_open'))).toBe(
			true
		);
		owner.close();
		expect(server_rules.broken()).toEqual([]);
	});

	it('a flight that keeps an error as its answer breaks the rule; one that fails keeps nothing', async () => {
		const failing = flights({
			name: 'probe fails',
			run: async () => {
				throw new Error('down');
			}
		});
		await expect(failing.get()).rejects.toThrow('down');
		expect(server_rules.broken()).toEqual([]);
		const keeps = flights({ name: 'probe keeps', run: async () => new TypeError('kept') });
		await keeps.get();
		expect(server_rules.broken()).toEqual([
			{ code: 'rule_flight_kept_failure', detail: '"probe keeps" kept TypeError: kept' }
		]);
	});
});
