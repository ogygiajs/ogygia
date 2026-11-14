/**
 * JUMPSTART'S COLD-START BENCH, Node only (the light version of the research lab's Docker bench,
 * internal/notes/design/server-chunks.md; the full one is ./docker.ts, run by hand). It writes the
 * bench app's source (e2e/bench-app, 225 blocks: `node e2e/generate.ts bench`), builds it with
 * adapter-node without jumpstart() and with it, and then, in fresh Node processes:
 *
 *   files     the files Node's ESM loader loads to import the CMS page's module
 *   cms       process start to listening (ready), then the first request to a CMS page
 *   light     the same, the first request to a page with no regions
 *
 * The OS file cache stays warm here (dropping it needs root), so the times are a lower bound of a
 * real cold start; the file counts are exact. Prints a Markdown table.
 *
 *   node bench/cold-start.ts [rounds=10]
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { dedent } from '@ogygia/core/plugin/utils';
import { Fixture } from '../e2e/fixture.ts';

const HERE = import.meta.dirname;
const APP = path.join(HERE, '../e2e/bench-app');
const PROBE = path.join(HERE, 'probe.ts');
const rounds = Number(process.argv[2] ?? 10);

type Row = Record<string, number>;

function probe(build: string, mode: string): Row {
	const out = execFileSync(process.execPath, [PROBE, build, mode], {
		encoding: 'utf8',
		env: { ...process.env, PROBE_PORT: '3291', NODE_OPTIONS: '' }
	});
	return JSON.parse(out.trim().split('\n').pop()!) as Row;
}

const median = (xs: number[]): number => {
	const s = [...xs].sort((a, b) => a - b);
	return Math.round(s[Math.floor(s.length / 2)]! * 10) / 10;
};

execFileSync(process.execPath, [path.join(HERE, '../e2e/generate.ts'), 'bench'], {
	stdio: 'inherit'
});
const app = new Fixture('bench-app');
const variants = [
	{ name: 'without jumpstart', v: { jumpstart: false }, build: path.join(APP, 'build') },
	{
		name: 'with jumpstart',
		v: { jumpstart: true, external: ['jumpstart-e2e-reads-file'] },
		build: path.join(APP, 'build-jumpstart')
	}
];
const rows: string[] = [];
for (const { name, v, build } of variants) {
	const built = await app.build(v);
	if (!built.ok) throw new Error(`the ${name} build failed:\n${built.log}`);
	const files = Fixture.js_files(path.join(build, 'server')).length;
	const loaded = probe(build, 'count').files_loaded!;
	const cms: Row[] = [];
	const light: Row[] = [];
	for (let r = 0; r < rounds; r++) {
		cms.push(probe(build, 'cms'));
		light.push(probe(build, 'light'));
	}
	const pick = (rs: Row[], k: string) => median(rs.map((x) => x[k]!));
	rows.push(
		`| ${name} | ${files} | ${loaded} | ${pick(cms, 'ready_ms')} | ${pick(cms, 'first_ms')} | ${pick(cms, 'first_done_ms')} | ${pick(light, 'first_done_ms')} | ${pick(cms, 'warm_p50_ms')} | ${pick(cms, 'rss_first_mb')} |`
	);
	console.error(`${name}: done`);
}
console.log(dedent`
	Medians of ${rounds} fresh processes (warm OS file cache), ms unless named:

	| build | server files | files loaded for the CMS page | ready | first CMS request | ready + first CMS | ready + first light | warm p50 | RSS after first, MB |
	| --- | --- | --- | --- | --- | --- | --- | --- | --- |
	${rows.join('\n')}
`);
