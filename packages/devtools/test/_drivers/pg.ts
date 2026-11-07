/**
 * A stand-in for the `pg` package (the tests' `pg` is this file: vitest.config.ts). Every query
 * answers after a turn of the event loop, like a real round trip; the first `fail` queries of a
 * pool reject, like a connection that blipped.
 */
export const made: Pool[] = [];

export class Pool {
	readonly queries: string[] = [];
	fail = 0;
	ended = false;

	constructor(_options?: { connectionString: string }) {
		made.push(this);
	}

	async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
		await new Promise((r) => setImmediate(r));
		this.queries.push(text);
		if (this.fail > 0) {
			this.fail--;
			throw new Error('connection reset');
		}
		return { rows: [] };
	}

	async end(): Promise<void> {
		this.ended = true;
	}
}

export default { Pool };
