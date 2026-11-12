/**
 * The SQLite store on a runtime without `node:sqlite`: it opens the file with better-sqlite3, and
 * with neither driver it says what to install.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const installed = new Set<string>();
const opened: string[] = [];

class BetterSqlite {
	constructor(file: string) {
		opened.push(file);
	}
	exec() {}
	prepare() {
		return { run() {}, get() {}, all: () => [] };
	}
	close() {}
}

vi.mock('node:module', async (original) => ({
	...(await original<typeof import('node:module')>()),
	createRequire: () => (id: string) => {
		if (!installed.has(id)) throw new Error(`Cannot find module '${id}'`);
		return BetterSqlite;
	}
}));

beforeEach(() => {
	installed.clear();
	opened.length = 0;
});

describe('a SQLite store without node:sqlite', () => {
	it('opens its file with better-sqlite3', async () => {
		installed.add('better-sqlite3');
		const { SqliteStore } = await import('../src/profiler/storage/sqlite.ts');
		expect(new SqliteStore(':memory:').listReports()).toEqual([]);
		expect(opened).toEqual([':memory:']);
	});

	it('with neither driver, says what to install', async () => {
		const { SqliteStore } = await import('../src/profiler/storage/sqlite.ts');
		expect(() => new SqliteStore(':memory:').listReports()).toThrow(/better-sqlite3/);
	});
});
