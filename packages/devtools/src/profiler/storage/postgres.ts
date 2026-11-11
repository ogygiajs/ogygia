import type {
	ProfilerStore,
	ProfilerRecord,
	ProfilerSummary,
	ProfilerVisitRecord
} from './index.ts';
import { flights, STALE, type Flights } from '@ogygia/machine';
import { MAX_VISITS_PER_KEY } from './visits.ts';

interface PgLike {
	query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
	end?(): Promise<void>;
}

async function resolve(client: PgLike | string): Promise<PgLike> {
	if (typeof client !== 'string') return client;
	const pgName = 'pg';
	const pg = (await import(pgName)) as unknown as {
		default?: { Pool: new (o: { connectionString: string }) => PgLike };
		Pool?: new (o: { connectionString: string }) => PgLike;
	};
	const Pool = pg.Pool ?? pg.default?.Pool;
	if (!Pool) throw new Error("ogygia/profiler: PostgresStore needs the 'pg' package.");
	return new Pool({ connectionString: client });
}

/**
 * A report store on Postgres, durable and shared by a team. Reports go in `ogygia_reports` (the
 * dump as `jsonb`, so a dashboard can query inside it, plus summary columns), visits in
 * `ogygia_visits`, the newest 2000 per page. `schema` puts the tables in a named schema; `table`
 * replaces the `ogygia` base name. Pass a connection string (`pg` is imported on demand) or a `pg`
 * Pool already made; after `close()`, the next call opens a new pool.
 *
 *   // src/hooks.server.ts
 *   import { setProfilerStore } from '@ogygia/devtools/profiler/storage';
 *   import { PostgresStore } from '@ogygia/devtools/profiler/storage/postgres';
 *   setProfilerStore(new PostgresStore(process.env.DATABASE_URL!));
 *   // or your own pool
 *   setProfilerStore(new PostgresStore(myPool));
 */
export class PostgresStore implements ProfilerStore {
	readonly kind: string = 'postgres';
	#client: PgLike | string;
	#schema: string | undefined;
	#base: string;
	#R: string;
	#V: string;
	/** the client, made once: two first calls share it, and a failure to make it is not kept */
	#connect: Flights<void, PgLike>;
	/** the client made, for `close` */
	#made: PgLike | null = null;
	/** the tables, made once: a setup that failed (a connection blip) is made again by the next call */
	readonly #setup: Flights<void, void>;

	constructor(client: PgLike | string, opts: { schema?: string; table?: string } = {}) {
		const base = opts.table ?? 'ogygia';
		const q = (n: string) => (opts.schema ? `"${opts.schema}"."${base}_${n}"` : `"${base}_${n}"`);
		this.#client = client;
		this.#schema = opts.schema;
		this.#base = base;
		this.#R = q('reports');
		this.#V = q('visits');
		this.#connect = this.#connector();
		this.#setup = flights({ name: 'profiler postgres tables', run: () => this.#create_tables() });
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
		const made = this.#made;
		this.#made = null;
		this.#connect = this.#connector();
		await made?.end?.();
	}

	#connector(): Flights<void, PgLike> {
		return flights({
			name: 'profiler postgres client',
			run: async () => (this.#made = await resolve(this.#client))
		});
	}

	/** The client (nothing drops a connector, so it is never STALE; were it, the current one is
	 *  asked). */
	async #client_made(): Promise<PgLike> {
		const c = await this.#connect.get();
		return c === STALE ? this.#client_made() : c;
	}

	async #need(): Promise<PgLike> {
		const c = await this.#client_made();
		await this.#setup.get();
		return c;
	}

	async #create_tables(): Promise<void> {
		const c = await this.#client_made();
		const R = this.#R;
		const V = this.#V;
		const base = this.#base;
		const schema = this.#schema;
		if (schema) await c.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
		await c.query(
			`CREATE TABLE IF NOT EXISTS ${R} (id TEXT PRIMARY KEY, created BIGINT NOT NULL, page TEXT, trigger TEXT, label TEXT, median DOUBLE PRECISION, dump JSONB NOT NULL)`
		);
		await c.query(`CREATE INDEX IF NOT EXISTS ${base}_reports_created ON ${R} (created DESC)`);
		await c.query(
			`CREATE TABLE IF NOT EXISTS ${V} (key TEXT PRIMARY KEY, page TEXT NOT NULL, at BIGINT NOT NULL, visit JSONB NOT NULL)`
		);
		await c.query(`CREATE INDEX IF NOT EXISTS ${base}_visits_page ON ${V} (page, at DESC)`);
	}
}
