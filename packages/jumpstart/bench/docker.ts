/**
 * JUMPSTART'S FULL COLD-START BENCH, run by hand (never in CI): the research lab's Docker bench
 * (internal/notes/design/server-chunks.md) over e2e/bench-app's two builds. Each measurement is a
 * fresh container on a slow box (--cpus=0.7, 1 GB) with the OS file cache dropped, on two disks:
 * `cold` (cache dropped, full speed) and `slow` (cache dropped, reads throttled to 400 IOPS and
 * 20 MB/s). Needs Docker with cgroup v2; the throttled device is `/dev/vdb` on Docker Desktop's VM
 * (`lsblk` in a container names it on another host).
 *
 *   node bench/cold-start.ts 1      build both variants (and a quick Node-only pass)
 *   node bench/docker.ts image      one deploy tree and one image per variant
 *   node bench/docker.ts run [n]    n rounds (default 10), rows in bench/results-docker/*.jsonl
 *   node bench/docker.ts report     medians as a Markdown table
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dedent } from '@ogygia/core/plugin/utils';

const HERE = import.meta.dirname;
const APP = path.join(HERE, '../e2e/bench-app');
const DEPLOY = path.join(APP, 'deploy');
const RAW = path.join(HERE, 'results-docker');
const VARIANTS: Readonly<Record<string, string>> = {
	default: 'build',
	jumpstart: 'build-jumpstart'
};
const MODES = ['cms', 'light'] as const;
const DISKS: Readonly<Record<string, readonly string[]>> = {
	cold: [],
	slow: ['--device-read-iops', '/dev/vdb:400', '--device-read-bps', '/dev/vdb:20mb']
};
const BOX = ['--cpus=0.7', '--memory=1g', '--memory-swap=1g'];
const stage = process.argv[2];

const sh = (cmd: string, args: string[]): string =>
	execFileSync(cmd, args, { cwd: APP, encoding: 'utf8', maxBuffer: 1 << 26 });

if (stage === 'image') {
	rmSync(DEPLOY, { recursive: true, force: true });
	sh('pnpm', [
		'--filter',
		'jumpstart-e2e-bench-app',
		'deploy',
		'--prod',
		'--legacy',
		path.join(DEPLOY, '_base')
	]);
	for (const [v, build] of Object.entries(VARIANTS)) {
		const tree = path.join(DEPLOY, v);
		cpSync(path.join(DEPLOY, '_base/node_modules'), path.join(tree, 'node_modules'), {
			recursive: true,
			verbatimSymlinks: true
		});
		cpSync(path.join(APP, build), path.join(tree, 'build'), { recursive: true });
		cpSync(path.join(HERE, 'probe.ts'), path.join(tree, 'probe.ts'));
		writeFileSync(path.join(tree, 'package.json'), '{ "type": "module" }\n');
		writeFileSync(
			path.join(tree, 'Dockerfile'),
			`${dedent`
				FROM node:24
				COPY . /app
				WORKDIR /app
			`}\n`
		);
		sh('docker', ['build', '-q', '-t', `ogygia-jumpstart-bench:${v}`, tree]);
		console.log(`${v}: image ready`);
	}
}

if (stage === 'run') {
	const rounds = Number(process.argv[3] ?? 10);
	mkdirSync(RAW, { recursive: true });
	for (let round = 1; round <= rounds; round++)
		for (const disk of Object.keys(DISKS))
			for (const v of Object.keys(VARIANTS))
				for (const mode of MODES) {
					const script = `sync; echo 3 > /proc/sys/vm/drop_caches; node -e 0; node probe.ts /app/build ${mode}`;
					let line: string;
					try {
						line = sh('docker', [
							'run',
							'--rm',
							'--privileged',
							...BOX,
							...DISKS[disk]!,
							`ogygia-jumpstart-bench:${v}`,
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
					appendFileSync(path.join(RAW, `${disk}.jsonl`), `${JSON.stringify(row)}\n`);
					console.log(JSON.stringify(row));
				}
}

if (stage === 'report') {
	type Row = Record<string, number | string>;
	const median = (xs: number[]): number => {
		const s = [...xs].sort((a, b) => a - b);
		return s.length ? Math.round(s[Math.floor(s.length / 2)]! * 10) / 10 : Number.NaN;
	};
	for (const disk of Object.keys(DISKS)) {
		const rows = readFileSync(path.join(RAW, `${disk}.jsonl`), 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l) as Row);
		const pick = (v: string, mode: string, key: string) =>
			median(
				rows
					.filter((r) => r.variant === v && r.mode === mode && typeof r[key] === 'number')
					.map((r) => r[key] as number)
			);
		console.log(dedent`

			### ${disk}

			| variant | ready | first CMS | ready + first CMS | ready + first light | warm p50 |
			| --- | --- | --- | --- | --- | --- |
		`);
		for (const v of Object.keys(VARIANTS))
			console.log(
				`| ${v} | ${pick(v, 'cms', 'ready_ms')} | ${pick(v, 'cms', 'first_ms')} | ${pick(v, 'cms', 'first_done_ms')} | ${pick(v, 'light', 'first_done_ms')} | ${pick(v, 'cms', 'warm_p50_ms')} |`
			);
	}
}
