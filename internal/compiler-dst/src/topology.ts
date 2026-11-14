/**
 * THE BUILD'S TOPOLOGY IS NOT AN INPUT. Kit 2 builds the server leg and the client leg in two plugin
 * instances (two sessions, nothing shared but the files); Kit 3 builds both legs in one instance;
 * `vite build --watch` builds again in the same instance. What each leg is served must not depend on
 * which (compiler study G.4, "topology").
 */
import { memory_fs } from '../../../packages/compiler/src/index.ts';
import { Server, type Served } from './dev.ts';
import { session, type Leg } from './session.ts';
import { rng } from './order.ts';

/** One build session on `files`: prescanned, nothing served yet; `seed` orders its requests. */
function build_server(files: Record<string, string>, seed: number | null = null): Server {
	const fs = memory_fs(files);
	const s = session(fs);
	s.compiler.prescan();
	return new Server(s, fs, seed === null ? null : rng(seed));
}

/** What each leg of a build was served, by `<leg> <id>`, and the chunks it emitted. */
export interface Built {
	readonly out: Record<string, Served>;
	readonly emitted: readonly string[];
}

const built = (servers: readonly Server[]): Built => {
	const out: Record<string, Served> = {};
	const emitted: string[] = [];
	for (const server of servers) {
		for (const [k, v] of server.served()) out[k] = v;
		emitted.push(...server.s.emitted);
	}
	return {
		out: Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1))),
		emitted: emitted.sort()
	};
};

/** Kit 3: one instance, the server leg then the client leg (modules requested in `seed`'s order). */
export async function kit3(
	files: Record<string, string>,
	seed: number | null = null
): Promise<Built> {
	const server = build_server(files, seed);
	await server.serve();
	return built([server]);
}

/** Kit 2: an instance per leg. */
export async function kit2(files: Record<string, string>): Promise<Built> {
	const legs: Leg[] = ['ssr', 'client'];
	const servers: Server[] = [];
	for (const leg of legs) {
		const server = build_server(files);
		await server.serve([leg]);
		servers.push(server);
	}
	return built(servers);
}
