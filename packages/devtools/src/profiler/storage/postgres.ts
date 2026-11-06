/**
 * Postgres report store — the durable, team-shared backend. Reports go in one `ogygia_reports`
 * table (a `jsonb` dump plus summary columns), visits in `ogygia_visits`. Pass a connection string
 * (the `pg` package is imported on demand) or an already-made `pg` Pool.
 *
 *   // src/hooks.server.ts
 *   import { setProfilerStore } from '@ogygia/devtools/profiler/storage';
 *   import { PostgresStore } from '@ogygia/devtools/profiler/storage/postgres';
 *   setProfilerStore(new PostgresStore(process.env.DATABASE_URL!));
 *   // or reuse your pool:
 *   setProfilerStore(new PostgresStore(myPool));
 *
 * `schema` puts the tables in a named schema; `table` overrides the base name. The dump is stored
 * as `jsonb`, so a hosted dashboard can query inside it (`dump->'meta'->>'page'`) without shipping
 * the whole blob.
 */
import type {
	ProfilerStore,
	ProfilerRecord,
	ProfilerSummary,
	ProfilerVisitRecord
} from './index.ts';
import { MAX_VISITS_PER_KEY } from './visits.ts';

interface PgLike {
	query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
	end?(): Promise<void>;
}

async function resolve(client: PgLike | string): Promise<PgLike> {
	if (typeof client !== 'string') return client;
	// indirect specifier so the type checker does not require `pg` to be installed (runtime peer)
	const pgName = 'pg';
	const pg = (await import(pgName)) as unknown as {
		default?: { Pool: new (o: { connectionString: string }) => PgLike };
		Pool?: new (o: { connectionString: string }) => PgLike;
	};
	const Pool = pg.Pool ?? pg.default?.Pool;
	if (!Pool) throw new Error("ogygia/profiler: PostgresStore needs the 'pg' package.");
	return new Pool({ connectionString: client });
}

export class PostgresStore implements ProfilerStore {
	readonly kind: string = 'postgres';
	#client: PgLike | string;
	#schema: string | undefined;
	#base: string;
	#R: string;
	#V: string;
	#c: PgLike | null = null;
	#ready: Promise<void> | null = null;

	constructor(client: PgLike | string, opts: { schema?: string; table?: string } = {}) {
		const base = opts.table ?? 'ogygia';
		const q = (n: string) => (opts.schema ? `"${opts.schema}"."${base}_${n}"` : `"${base}_${n}"`);
		this.#client = client;
		this.#schema = opts.schema;
		this.#base = base;
		this.#R = q('reports');
		this.#V = q('visits');
	}

	async init(): Promise<void> {
		await this.#need();
	}

	async putReport(rec: ProfilerRecord): Promise<void> {
		const db = await this.#need();
		await db.query(
			`INSERT INTO ${this.#R} (id,created,page,trigger,label,median,dump) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
			 ON CONFLICT (id) DO UPDATE SET created=EXCLUDED.created,page=EXCLUDED.page,trigger=EXCLUDED.trigger,label=EXCLUDED.label,median=EXCLUDED.median,dump=EXCLUDED.dump`,
			[rec.id, rec.created, rec.page, rec.trigger, rec.label, rec.median, rec.dump]
		);
	}

	async getReport(id: string): Promise<string | null> {
		const { rows } = await (
			await this.#need()
		).query(`SELECT dump FROM ${this.#R} WHERE id = $1`, [id]);
		if (!rows.length) return null;
		const d = rows[0].dump;
		return typeof d === 'string' ? d : JSON.stringify(d);
	}

	async listReports(limit = 30): Promise<ProfilerSummary[]> {
		const { rows } = await (
			await this.#need()
		).query(
			`SELECT id,created,page,trigger,label,median FROM ${this.#R} ORDER BY created DESC LIMIT $1`,
			[limit]
		);
		return rows.map((r) => ({
			id: r.id as string,
			created: Number(r.created),
			page: (r.page as string) ?? null,
			trigger: r.trigger as string,
			label: r.label as string,
			median: r.median === null ? null : Number(r.median)
		}));
	}

	async deleteReport(id: string): Promise<void> {
		await (await this.#need()).query(`DELETE FROM ${this.#R} WHERE id = $1`, [id]);
	}

	async prune(keep: number): Promise<void> {
		const R = this.#R;
		await (
			await this.#need()
		).query(
			`DELETE FROM ${R} WHERE id NOT IN (SELECT id FROM ${R} ORDER BY created DESC LIMIT $1)`,
			[keep]
		);
	}

	async putVisit(rec: ProfilerVisitRecord): Promise<void> {
		const V = this.#V;
		const db = await this.#need();
		await db.query(
			`INSERT INTO ${V} (key,page,at,visit) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (key) DO UPDATE SET at=EXCLUDED.at,visit=EXCLUDED.visit`,
			[rec.key, rec.page, rec.at, rec.visit]
		);
		// the newest MAX_VISITS_PER_KEY per key (what a server window reads back)
		await db.query(
			`DELETE FROM ${V} WHERE page = $1 AND key NOT IN (SELECT key FROM ${V} WHERE page = $1 ORDER BY at DESC LIMIT $2)`,
			[rec.page, MAX_VISITS_PER_KEY]
		);
	}

	async listVisits(page: string, limit = 10): Promise<ProfilerVisitRecord[]> {
		const { rows } = await (
			await this.#need()
		).query(`SELECT key,page,at,visit FROM ${this.#V} WHERE page = $1 ORDER BY at DESC LIMIT $2`, [
			page,
			limit
		]);
		return rows.map((r) => ({
			key: r.key as string,
			page: r.page as string,
			at: Number(r.at),
			visit: typeof r.visit === 'string' ? (r.visit as string) : JSON.stringify(r.visit)
		}));
	}

	async close(): Promise<void> {
		await this.#c?.end?.();
		this.#c = null;
	}

	async #need(): Promise<PgLike> {
		const c = (this.#c ??= await resolve(this.#client));
		const R = this.#R;
		const V = this.#V;
		const base = this.#base;
		const schema = this.#schema;
		this.#ready ??= (async () => {
			if (schema) await c.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
			await c.query(
				`CREATE TABLE IF NOT EXISTS ${R} (id TEXT PRIMARY KEY, created BIGINT NOT NULL, page TEXT, trigger TEXT, label TEXT, median DOUBLE PRECISION, dump JSONB NOT NULL)`
			);
			await c.query(`CREATE INDEX IF NOT EXISTS ${base}_reports_created ON ${R} (created DESC)`);
			await c.query(
				`CREATE TABLE IF NOT EXISTS ${V} (key TEXT PRIMARY KEY, page TEXT NOT NULL, at BIGINT NOT NULL, visit JSONB NOT NULL)`
			);
			await c.query(`CREATE INDEX IF NOT EXISTS ${base}_visits_page ON ${V} (page, at DESC)`);
		})();
		await this.#ready;
		return this.#c!;
	}
}
