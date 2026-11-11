/**
 * THE SERVER'S RULES for region answers (src/server/rules.ts, INVARIANTS CAPABILITY-URL and
 * PRELOAD-CACHE): every answer of the region endpoint keeps its capability out of a Referer and out
 * of every shared cache, and every minted capability is a same-origin path. Own file: a broken rule
 * here stays broken for the module.
 */
import { describe, expect, it, vi } from 'vitest';
import {
	install_server_rules,
	note_minted_capability,
	note_region_answer,
	region_answer_unsafe,
	server_rules
} from '../src/server/rules.ts';

install_server_rules();
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const answer = (headers: Record<string, string>) => new Response(null, { status: 200, headers });
const SAFE = { 'referrer-policy': 'no-referrer' };

describe('region answer headers', () => {
	it('no-store or private, with no-referrer, is safe', () => {
		for (const cache of [
			'no-store',
			'private, max-age=60',
			'Private,Max-Age=5',
			'no-store, private'
		])
			expect(region_answer_unsafe(answer({ ...SAFE, 'cache-control': cache }))).toBeNull();
	});

	it('a missing header, public, s-maxage or another referrer policy is not', () => {
		const unsafe: Record<string, string>[] = [
			{ ...SAFE },
			{ ...SAFE, 'cache-control': 'max-age=60' },
			{ ...SAFE, 'cache-control': 'public, max-age=60' },
			{ ...SAFE, 'cache-control': 'private, s-maxage=60' },
			{ 'cache-control': 'no-store' },
			{ 'cache-control': 'no-store', 'referrer-policy': 'origin' }
		];
		for (const h of unsafe) expect(region_answer_unsafe(answer(h))).not.toBeNull();
	});
});

describe('server rules: region answers and minted capabilities', () => {
	it('safe answers and path-only capabilities break nothing', async () => {
		note_region_answer('/__ogygia__', answer({ ...SAFE, 'cache-control': 'no-store' }));
		note_minted_capability('/__ogygia__?id=abc&sig=00');
		note_minted_capability('/base/__ogygia__?id=abc');
		await tick();
		expect(server_rules.broken()).toEqual([]);
	});

	it('an answer without its headers, and a capability with a host, are said with their codes', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		note_region_answer('/__ogygia__', answer({ 'cache-control': 'public, max-age=60' }));
		note_minted_capability('https://cdn.example/__ogygia__?id=abc&sig=secret');
		note_minted_capability('//cdn.example/__ogygia__?id=abc');
		await tick();
		const broken = server_rules.broken();
		expect(broken.map((b) => b.code)).toEqual([
			'rule_region_answer_shared',
			'rule_capability_not_path'
		]);
		// (the address only: never the capability's query)
		expect(broken[1]!.detail).not.toContain('sig=');
		const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
		expect(said).toContain('rule_region_answer_shared');
		expect(said).toContain('rule_capability_not_path');
		warn.mockRestore();
	});
});
