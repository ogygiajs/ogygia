// The SQLite store opens its file with the built-in node:sqlite, and only when that module is not
// there tries better-sqlite3. A file node:sqlite cannot open (a directory, a path it may not write)
// must fail with ITS error: falling through replaced it with "needs Node 22.5+ or better-sqlite3",
// which is not the reason on a Node that has node:sqlite.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { SqliteStore } from '../src/profiler/storage/sqlite.ts';

describe('a SQLite store whose file cannot be opened', () => {
	it("fails with node:sqlite's own error, not a missing driver", async () => {
		// a directory is not a database file
		const store = new SqliteStore(mkdtempSync(`${tmpdir()}/og-sqlite-`));
		let error: unknown;
		try {
			await store.listReports(1);
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).not.toContain('needs Node 22.5+');
		expect((error as Error).message).toMatch(/open|database/i);
	});
});
