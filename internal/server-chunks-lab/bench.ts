/**
 * The server-chunks benchmark (internal/notes/design/server-chunks.md). Stages:
 *
 *   node bench.ts build     generate the fixture, build every variant into builds/<variant>
 *   node bench.ts verify    serve each build, check its pages are byte-identical to `default`'s,
 *                           and print each server build's file count and size
 *   node bench.ts image     a self-contained tree per variant (deploy/), one Docker image each
 *   node bench.ts run [n]   n rounds (default 10) of cold runs in fresh containers, on a slow box:
 *                           --cpus=0.7, 1 GB, OS file cache dropped before each run; in two disk
 *                           modes: "cold" (cache dropped) and "slow" (cache dropped and reads
 *                           throttled to READ_IOPS / READ_BPS). Writes results-raw/*.jsonl
 *   node bench.ts report    medians and spreads into results.json and a Markdown table
 *
 * Needs Docker. `build`, `verify` and `image` run on the host; `run` starts one container per
 * measurement (privileged: it drops the VM's page cache).
 */
import { execFileSync, spawn } from 'node:child_process';
import { appendFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const VARIANTS = (
	process.env.LAB_VARIANTS ?? 'default,registry,vendor,grouped,single,bundled,split'
).split(',');
const MODES = ['cms', 'light', 'registry'] as const;
const DISKS: Record<string, string[]> = {
	cold: [],
	// a slow volume: few reads per second and little bandwidth on the container's disk
	slow: ['--device-read-iops', '/dev/vdb:400', '--device-read-bps', '/dev/vdb:20mb']
};
const BOX = ['--cpus=0.7', '--memory=1g', '--memory-swap=1g'];
const stage = process.argv[2];

function sh(cmd: string, args: string[], env: Record<string, string> = {}): string {
	return execFileSync(cmd, args, {
		cwd: ROOT,
		env: { ...process.env, ...env },
		encoding: 'utf8',
		maxBuffer: 1 << 26
	});
}

async function files_of(dir: string): Promise<{ count: number; bytes: number; largest: number }> {
	let count = 0;
	let bytes = 0;
	let largest = 0;
	for (const f of await readdir(dir, { recursive: true })) {
		if (!f.endsWith('.js')) continue;
		const s = await stat(join(dir, f));
		count++;
		bytes += s.size;
		largest = Math.max(largest, s.size);
	}
	return { count, bytes, largest };
}

if (stage === 'build') {
	sh('node', ['generate.ts']);
	for (const v of VARIANTS) {
		const t = performance.now();
		await rm(join(ROOT, 'builds', v), { recursive: true, force: true });
		sh('npx', ['vite', 'build'], { LAB_CHUNKS: v, LAB_OUT: 'builds/' + v });
		console.log(v + ': built in ' + Math.round((performance.now() - t) / 1000) + ' s');
	}
}

if (stage === 'verify') {
	const PAGES = ['/', '/about', '/p/1', '/p/3', '/p/7', '/p/42'];
	const bodies = new Map<string, string[]>();
	let port = 4950;
	for (const v of VARIANTS) {
		const p = port++;
		const child = spawn('node', ['builds/' + v + '/index.js'], {
			cwd: ROOT,
			env: { ...process.env, PORT: String(p) },
			stdio: ['ignore', 'pipe', 'inherit']
		});
		await new Promise<void>((resolve) =>
			child.stdout!.on('data', (d: Buffer) => d.toString().includes('Listening') && resolve())
		);
		const got: string[] = [];
		for (const path of PAGES) {
			const res = await fetch('http://127.0.0.1:' + p + path);
			if (res.status !== 200) throw new Error(v + ' ' + path + ' answered ' + res.status);
			got.push(await res.text());
		}
		child.kill();
		bodies.set(v, got);
		const server = await files_of(join(ROOT, 'builds', v, 'server'));
		const same = bodies.get('default')!.every((b, i) => b === got[i]);
		console.log(
			`${v}: ${same ? 'identical to default' : 'DIFFERS from default'}; server ${server.count} files, ` +
				`${(server.bytes / 1e6).toFixed(2)} MB, largest ${(server.largest / 1e6).toFixed(2)} MB`
		);
	}
}

if (stage === 'image') {
	// one copy of the production dependencies (what the zip carries), then a tree per variant
	await rm(join(ROOT, 'deploy'), { recursive: true, force: true });
	sh('pnpm', [
		'--filter',
		'ogygia-server-chunks-lab',
		'deploy',
		'--prod',
		'--legacy',
		join(ROOT, 'deploy/_base')
	]);
	for (const v of VARIANTS) {
		const tree = join(ROOT, 'deploy', v);
		await cp(join(ROOT, 'deploy/_base/node_modules'), join(tree, 'node_modules'), {
			recursive: true,
			verbatimSymlinks: true
		});
		await cp(join(ROOT, 'builds', v), join(tree, 'build'), { recursive: true });
		await writeFile(join(tree, 'package.json'), '{ "type": "module" }\n');
		await cp(join(ROOT, 'probe.ts'), join(tree, 'probe.ts'));
		await writeFile(join(tree, 'Dockerfile'), 'FROM node:22\nCOPY . /app\nWORKDIR /app\n');
		sh('docker', ['build', '-q', '-t', 'ogygia-chunks-lab:' + v, tree]);
		console.log(v + ': image ready');
	}
}

if (stage === 'run') {
	const rounds = Number(process.argv[3] ?? 10);
	await mkdir(join(ROOT, 'results-raw'), { recursive: true });
	for (let round = 1; round <= rounds; round++) {
		for (const disk of Object.keys(DISKS)) {
			for (const v of VARIANTS) {
				for (const mode of MODES) {
					// drop the page cache, warm the Node binary only (a runtime is warm on a real host;
					// the function's own files are not), then one fresh process
					const script =
						'sync; echo 3 > /proc/sys/vm/drop_caches; node -e 0; node probe.ts /app ' + mode;
					let line: string;
					try {
						line = sh('docker', [
							'run',
							'--rm',
							'--privileged',
							...BOX,
							...DISKS[disk]!,
							'ogygia-chunks-lab:' + v,
							'sh',
							'-c',
							script
						])
							.trim()
							.split('\n')
							.pop()!;
					} catch (e) {
						line = JSON.stringify({ mode, error: String(e).slice(0, 300) });
					}
					const row = { round, disk, variant: v, ...JSON.parse(line) };
					await appendFile(join(ROOT, 'results-raw', disk + '.jsonl'), JSON.stringify(row) + '\n');
					console.log(JSON.stringify(row));
				}
			}
		}
	}
}

if (stage === 'count') {
	for (const v of VARIANTS)
		console.log(
			v +
				' ' +
				sh('docker', [
					'run',
					'--rm',
					'ogygia-chunks-lab:' + v,
					'node',
					'probe.ts',
					'/app',
					'count'
				]).trim()
		);
}

if (stage === 'report') {
	type Row = Record<string, number | string> & { disk: string; variant: string; mode: string };
	const rows: Row[] = [];
	for (const disk of Object.keys(DISKS)) {
		const text = await readFile(join(ROOT, 'results-raw', disk + '.jsonl'), 'utf8').catch(() => '');
		for (const l of text.split('\n')) if (l) rows.push(JSON.parse(l) as Row);
	}
	const med = (xs: number[]): number => {
		const s = [...xs].sort((a, b) => a - b);
		return s.length ? Math.round(s[Math.floor(s.length / 2)]! * 10) / 10 : NaN;
	};
	const p90 = (xs: number[]): number => {
		const s = [...xs].sort((a, b) => a - b);
		return s.length
			? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]! * 10) / 10
			: NaN;
	};
	const pick = (disk: string, v: string, mode: string, key: string): number[] =>
		rows
			.filter(
				(r) => r.disk === disk && r.variant === v && r.mode === mode && typeof r[key] === 'number'
			)
			.map((r) => r[key] as number);
	const summary: Record<string, unknown>[] = [];
	for (const disk of Object.keys(DISKS)) {
		console.log(`\n### ${disk}\n`);
		console.log(
			'| variant | n | registry import ms | ready ms | first CMS req ms | ready + first ms | first light req ms | warm p50 / p95 ms | RSS ready / first / warm MB | errors |'
		);
		console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
		for (const v of VARIANTS) {
			const s = {
				disk,
				variant: v,
				n: pick(disk, v, 'cms', 'first_ms').length,
				registry: med(pick(disk, v, 'registry', 'registry_import_ms')),
				registry_p90: p90(pick(disk, v, 'registry', 'registry_import_ms')),
				ready: med(pick(disk, v, 'cms', 'ready_ms')),
				first: med(pick(disk, v, 'cms', 'first_ms')),
				first_p90: p90(pick(disk, v, 'cms', 'first_ms')),
				ready_first: med(pick(disk, v, 'cms', 'first_done_ms')),
				light: med(pick(disk, v, 'light', 'first_ms')),
				light_ready_first: med(pick(disk, v, 'light', 'first_done_ms')),
				warm_p50: med(pick(disk, v, 'cms', 'warm_p50_ms')),
				warm_p95: med(pick(disk, v, 'cms', 'warm_p95_ms')),
				rss_ready: med(pick(disk, v, 'cms', 'rss_ready_mb')),
				rss_first: med(pick(disk, v, 'cms', 'rss_first_mb')),
				rss_warm: med(pick(disk, v, 'cms', 'rss_warm_mb')),
				errors: rows.filter((r) => r.disk === disk && r.variant === v && r.error).length
			};
			summary.push(s);
			console.log(
				`| ${v} | ${s.n} | ${s.registry} (p90 ${s.registry_p90}) | ${s.ready} | ${s.first} (p90 ${s.first_p90}) | ${s.ready_first} | ${s.light} | ${s.warm_p50} / ${s.warm_p95} | ${s.rss_ready} / ${s.rss_first} / ${s.rss_warm} | ${s.errors} |`
			);
		}
	}
	await writeFile(
		join(ROOT, 'results.json'),
		JSON.stringify(
			{ date: new Date().toISOString(), box: BOX, disks: DISKS, summary },
			null,
			'\t'
		) + '\n'
	);
}
