// THE MESSAGE SYSTEM (src/messages): a code's message is its wording and its page's link in dev, the
// link alone without the table (a production build passes none), and every message the browser-side
// source prints comes from a table.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { define_messages } from '../src/messages/define.ts';
import { ERRORS, WARNINGS, OgygiaError, warn } from '../src/messages/core.ts';
import { prose } from '../src/messages/prose.ts';

const SRC = path.join(import.meta.dirname, '../src');

function files(dir: string): string[] {
	const out: string[] = [];
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		if (fs.statSync(p).isDirectory()) out.push(...files(p));
		else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
	}
	return out;
}

describe('OgygiaError and warn', () => {
	it('dev: the wording, then the link with the arguments', () => {
		const err = new OgygiaError('island_load_failed', { entry: '/a.js' });
		expect(err.code).toBe('island_load_failed');
		expect(err.name).toBe('OgygiaError');
		expect(err.message).toBe(
			'[ogygia] island entry failed to load: /a.js\nhttps://ogygiajs.dev/e/island_load_failed?entry=%2Fa.js'
		);
		expect(new OgygiaError('goto_not_http').message).toBe(
			'[ogygia] goto() only supports http(s) URLs\nhttps://ogygiajs.dev/e/goto_not_http'
		);
	});

	it('without the table (a production build): the link alone', () => {
		const prod = define_messages<typeof ERRORS, typeof WARNINGS>(null, null);
		expect(new prod.OgygiaError('island_load_failed', { entry: '/a.js' }).message).toBe(
			'[ogygia] https://ogygiajs.dev/e/island_load_failed?entry=%2Fa.js'
		);
		const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
		prod.warn('region_fetch_failed', { endpoint: '/x' });
		expect(log).toHaveBeenCalledWith(
			'[ogygia] https://ogygiajs.dev/e/region_fetch_failed?endpoint=%2Fx'
		);
		log.mockRestore();
	});

	it('warn: the arguments are the plain object after the code; what follows rides along', () => {
		const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const cause = new Error('boom');
		warn('region_fetch_failed', { endpoint: '/x' }, cause);
		expect(log.mock.calls[0][0]).toContain('region fetch failed for /x');
		expect(log.mock.calls[0][1]).toBe(cause);
		warn('live_feature_missing');
		expect(log.mock.calls[1]).toHaveLength(1);
		log.mockRestore();
	});

	it('an empty or missing argument stays out of the link; a long one is cut to 300 characters', () => {
		const err = new OgygiaError('slot_not_linked', { name: 'x'.repeat(400) });
		expect(new URL(err.message.split('\n')[1]).searchParams.get('name')).toHaveLength(300);
		const healed = define_messages<typeof ERRORS, typeof WARNINGS>(null, null);
		const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
		healed.warn('island_healed', { entry: '/e.js', drift: null });
		expect(log.mock.calls[0][0]).toBe(
			'[ogygia] https://ogygiajs.dev/e/island_healed?entry=%2Fe.js'
		);
		log.mockRestore();
	});
});

describe('the tables', () => {
	it('no code is both an error and a warning', () => {
		const both = Object.keys(ERRORS).filter((c) => c in WARNINGS);
		expect(both).toEqual([]);
	});

	it("each code's page reads as plain sentences: no { } or < outside backticks (the docs render it)", () => {
		const bad = Object.entries({ ...ERRORS, ...WARNINGS })
			.filter(([, m]) => /[{}<]/.test(m.details().replace(/`[^`]*`/g, '')))
			.map(([c]) => c);
		expect(bad).toEqual([]);
	});

	it('every message the browser-side source prints comes from a table', () => {
		const raw: string[] = [];
		const unknown: string[] = [];
		const codes = new Set([...Object.keys(ERRORS), ...Object.keys(WARNINGS)]);
		for (const dir of ['runtime', 'shims']) {
			for (const f of files(path.join(SRC, dir))) {
				const src = fs.readFileSync(f, 'utf8');
				for (const m of src.matchAll(/(['"`])\[ogygia\] ([^'"`]*)/g)) {
					const link = m[2].match(/^https:\/\/ogygiajs\.dev\/e\/([a-z_]+)/);
					if (!link) raw.push(`${path.relative(SRC, f)}: ${m[2].slice(0, 60)}`);
					else if (!codes.has(link[1])) unknown.push(`${path.relative(SRC, f)}: ${link[1]}`);
				}
			}
		}
		expect(raw, 'wording written in place: give it a code in src/messages/core.ts').toEqual([]);
		expect(unknown, 'a link to a code no table has').toEqual([]);
	});
});

describe('prose', () => {
	it('joins a paragraph into one line, a blank line starts the next, an empty one is dropped', () => {
		const empty = '';
		expect(prose`
			one two
			three ${'x'} four

			${empty}

			five
		`).toBe('one two three x four\nfive');
	});

	it('keeps the space before a value, and the value as it is', () => {
		expect(prose`a ${'b  c'}
			d`).toBe('a b  c d');
	});
});
