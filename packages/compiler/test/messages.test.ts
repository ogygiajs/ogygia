// THE MESSAGE SYSTEM (src/messages): a code's message is its wording and its page's link in dev, the
// link alone without the table (a production build passes none), and every message the browser-side
// source prints comes from a table.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { define_messages } from '../../core/src/contract/messages.ts';
import { ERRORS, WARNINGS, OgygiaError, warn } from '../../core/src/messages/core.ts';
import { prose } from '../../core/src/contract/prose.ts';
import { SERVER_ERRORS, SERVER_WARNINGS } from '../../core/src/messages/server.ts';
import { BUILD_ERRORS, BUILD_REPORTS, BUILD_WARNINGS } from '../src/messages.ts';
import type { MessageEntry } from '../../core/src/contract/messages.ts';

const TABLES: Record<string, MessageEntry<never>> = {
	...ERRORS,
	...WARNINGS,
	...SERVER_ERRORS,
	...SERVER_WARNINGS,
	...BUILD_ERRORS,
	...BUILD_WARNINGS
};

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

describe('a server bundle: worded in dev and while prerendering', () => {
	it('a production server prints the link alone; a prerender, the wording and the link', async () => {
		const { dev_or_prerender } = await import('../../core/src/contract/messages.ts');
		vi.stubEnv('DEV', false);
		const key = Symbol.for('ogygia.prerendering');
		const g = globalThis as unknown as Record<symbol, unknown>;
		const before = g[key];
		try {
			const server = define_messages(SERVER_ERRORS, SERVER_WARNINGS, dev_or_prerender);
			g[key] = false;
			expect(new server.OgygiaError('handle_secret_too_short', { min: 32 }).message).toBe(
				'[ogygia] https://ogygiajs.dev/e/handle_secret_too_short?min=32'
			);
			g[key] = true;
			expect(new server.OgygiaError('handle_secret_too_short', { min: 32 }).message).toBe(
				`[ogygia] handle({ secret }) is too short for production (need ≥32 UTF-8 bytes).\nhttps://ogygiajs.dev/e/handle_secret_too_short?min=32`
			);
		} finally {
			g[key] = before;
			vi.unstubAllEnvs();
		}
	});
});

describe('the tables', () => {
	it('no code is both an error and a warning', () => {
		const both = Object.keys(ERRORS).filter((c) => c in WARNINGS);
		expect(both).toEqual([]);
	});

	it("each code's page reads as plain sentences: no { } or < outside backticks (the docs render it)", () => {
		const bad = Object.entries(TABLES)
			.filter(([, m]) => /[{}<]/.test(m.details().replace(/`[^`]*`/g, '')))
			.map(([c]) => c);
		expect(bad).toEqual([]);
	});

	it('every message the source prints comes from a table', () => {
		const raw: string[] = [];
		const unknown: string[] = [];
		const codes = new Set(Object.keys(TABLES));
		for (const f of files(SRC)) {
			// (the tables and the machine that words them: messages/, and the two that moved by side)
			if (f.includes(`${path.sep}messages${path.sep}`) || f.endsWith(`${path.sep}messages.ts`))
				continue;
			const src = fs.readFileSync(f, 'utf8');
			for (const m of src.matchAll(/(['"`])\[ogygia\] ([^'"`]*)/g)) {
				const link = m[2].match(/^https:\/\/ogygiajs\.dev\/e\/([a-z_]+)/);
				if (!link) raw.push(`${path.relative(SRC, f)}: ${m[2].slice(0, 60)}`);
				else if (!codes.has(link[1])) unknown.push(`${path.relative(SRC, f)}: ${link[1]}`);
			}
		}
		expect(raw, 'wording written in place: give it a code in src/messages/').toEqual([]);
		expect(unknown, 'a link to a code no table has').toEqual([]);
	});

	it('a code is in one table only (one namespace across the runtime, server and build)', () => {
		const seen = new Map<string, number>();
		for (const t of [
			ERRORS,
			WARNINGS,
			SERVER_ERRORS,
			SERVER_WARNINGS,
			BUILD_ERRORS,
			BUILD_WARNINGS
		])
			for (const code of Object.keys(t)) seen.set(code, (seen.get(code) ?? 0) + 1);
		expect([...seen].filter(([, n]) => n > 1).map(([c]) => c)).toEqual([]);
	});

	it('a build report prints through line(), never warn()', () => {
		const reports = Object.keys(BUILD_REPORTS);
		const warned: string[] = [];
		const lined = new Set<string>();
		for (const f of files(SRC)) {
			const text = fs.readFileSync(f, 'utf8');
			for (const code of reports) {
				if (text.includes(`warn('${code}'`)) warned.push(`${path.relative(SRC, f)}: ${code}`);
				if (text.includes(`line('${code}'`)) lined.add(code);
			}
		}
		expect(warned).toEqual([]);
		expect([...lined].sort()).toEqual([...reports].sort());
	});
});

describe('a tombstone (a code that only points at a removed spelling) names the release that deletes it', () => {
	const version = (
		JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8')) as {
			version: string;
		}
	).version;
	const minor = (v: string) => v.split('.').slice(0, 2).map(Number) as [number, number];
	const before = (a: [number, number], b: [number, number]) =>
		a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

	it('the 0.14 tombstones go in 0.15', () => {
		const until = (code: string) => (TABLES[code] as { until?: string } | undefined)?.until;
		expect({
			as_region_removed: until('as_region_removed'),
			barrels_option_removed: until('barrels_option_removed'),
			handle_transform_moved: until('handle_transform_moved'),
			hole_wake_removed: until('hole_wake_removed')
		}).toEqual({
			as_region_removed: '0.15',
			barrels_option_removed: '0.15',
			handle_transform_moved: '0.15',
			hole_wake_removed: '0.15'
		});
	});

	it('the build breaks once the version reaches a tombstone’s release, so it is deleted then', () => {
		for (const e of Object.values(TABLES)) {
			const until = (e as { until?: string }).until;
			if (until !== undefined) expect(until).toMatch(/^\d+\.\d+$/);
		}
		const due = Object.entries(TABLES)
			.filter(([, e]) => {
				const until = (e as { until?: string }).until;
				return until !== undefined && !before(minor(version), minor(until));
			})
			.map(([code]) => code);
		expect(due).toEqual([]);
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
