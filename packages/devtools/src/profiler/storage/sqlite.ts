import { createRequire } from 'node:module';
import type {
	ProfilerStore,
	ProfilerRecord,
	ProfilerSummary,
	ProfilerVisitRecord
} from './index.ts';
import { MAX_VISITS_PER_KEY } from './visits.ts';

const require = createRequire(import.meta.url);

interface SyncDb {
	exec(sql: string): void;
	prepare(sql: string): SyncStmt;
	close(): void;
}
interface SyncStmt {
	run(...args: unknown[]): unknown;
	get(...args: unknown[]): unknown;
	all(...args: unknown[]): unknown[];
}

function open(filename: string): SyncDb {
	if (filename !== ':memory:' && !filename.startsWith('file::memory:')) {
		try {
			const fs = require('node:fs') as typeof import('node:fs');
			const path = require('node:path') as typeof import('node:path');
			const dir = path.dirname(filename);
			if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
		} catch {
			// ok: best effort; the open below fails with the real problem
		}
	}
	const built_in = load_driver<{ DatabaseSync: new (p: string) => SyncDb }>('node:sqlite');
	if (built_in) return new built_in.DatabaseSync(filename);
	const Database = load_driver<new (p: string) => SyncDb>('better-sqlite3');
	if (Database) return new Database(filename);
	throw new Error(
		"ogygia/profiler: SqliteStore needs Node 22.5+ (built-in node:sqlite) or the 'better-sqlite3' package."
	);
}

function load_driver<T>(id: string): T | null {
	try {
		return require(id) as T;
	} catch {
		return null; // ok: not installed: the next driver is tried, and none says what to install
	}
}

/**
 * A report store in one SQLite file (or `:memory:`): no server, and it survives a restart. It opens
 * the file with the built-in `node:sqlite`, or `better-sqlite3` when that is not there; a driver
 * that is there and cannot open the file fails with its own error. It makes the file's folders, and
 * keeps the newest 2000 visits per page.
 *
 *   // src/hooks.server.ts
 *   import { setProfilerStore } from '@ogygia/devtools/profiler/storage';
 *   import { SqliteStore } from '@ogygia/devtools/profiler/storage/sqlite';
 *   setProfilerStore(new SqliteStore('.ogygia/profiles.db'));
 */
export class SqliteStore implements ProfilerStore {
	readonly kind: string = 'sqlite';
	#filename: string;
	#db: SyncDb | null = null;

	constructor(filename = '.ogygia/profiles.db') {
		this.#filename = filename;
	}

	init(): void {
		this.#need();
	}

	putReport(rec: ProfilerRecord): void {
		this.#need()
			.prepare(
				'INSERT INTO reports (id,created,page,trigger,label,median,dump) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created=excluded.created,page=excluded.page,trigger=excluded.trigger,label=excluded.label,median=excluded.median,dump=excluded.dump'
			)
			.run(rec.id, rec.created, rec.page, rec.trigger, rec.label, rec.median, rec.dump);
	}

	getReport(id: string): string | null {
		const row = this.#need().prepare('SELECT dump FROM reports WHERE id = ?').get(id) as
			| { dump: string }
			| undefined;
		return row?.dump ?? null;
	}

	listReports(limit = 30): ProfilerSummary[] {
		return this.#need()
			.prepare(
				'SELECT id,created,page,trigger,label,median FROM reports ORDER BY created DESC LIMIT ?'
			)
			.all(limit) as ProfilerSummary[];
	}

	deleteReport(id: string): void {
		this.#need().prepare('DELETE FROM reports WHERE id = ?').run(id);
	}

	prune(keep: number): void {
		this.#need()
			.prepare(
				'DELETE FROM reports WHERE id NOT IN (SELECT id FROM reports ORDER BY created DESC LIMIT ?)'
			)
			.run(keep);
	}

	putVisit(rec: ProfilerVisitRecord): void {
		this.#need()
			.prepare(
				'INSERT INTO visits (key,page,at,visit) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET at=excluded.at,visit=excluded.visit'
			)
			.run(rec.key, rec.page, rec.at, rec.visit);
		this.#need()
			.prepare(
				'DELETE FROM visits WHERE key IN (SELECT key FROM visits WHERE page = ? ORDER BY at DESC LIMIT -1 OFFSET ?)'
			)
			.run(rec.page, MAX_VISITS_PER_KEY);
	}

	listVisits(page: string, limit = 10): ProfilerVisitRecord[] {
		return this.#need()
			.prepare('SELECT key,page,at,visit FROM visits WHERE page = ? ORDER BY at DESC LIMIT ?')
			.all(page, limit) as ProfilerVisitRecord[];
	}

	close(): void {
		this.#db?.close();
		this.#db = null;
	}

	#need(): SyncDb {
		if (this.#db) return this.#db;
		const db = (this.#db = open(this.#filename));
		db.exec(`
			CREATE TABLE IF NOT EXISTS reports (
				id TEXT PRIMARY KEY, created INTEGER NOT NULL, page TEXT, trigger TEXT,
				label TEXT, median REAL, dump TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS reports_created ON reports (created);
			CREATE TABLE IF NOT EXISTS visits (
				key TEXT PRIMARY KEY, page TEXT NOT NULL, at INTEGER NOT NULL, visit TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS visits_page ON visits (page, at);
		`);
		return db;
	}
}
