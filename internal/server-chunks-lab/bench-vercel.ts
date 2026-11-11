/**
 * Real cold starts on a serverless host (server-chunks.md, section 10). For each variant built with
 * `LAB_ADAPTER=vercel` into builds/vercel-<variant>/.vercel/output (a linked project in
 * .vercel/project.json), it makes N preview deployments of the same prebuilt output (a new
 * deployment's first request is always a cold start; the files are uploaded once, then reused),
 * and on each asks /p/3 twice: cold, then warm. Every deployment is removed at the end.
 *
 *   node bench-vercel.ts 15                         # default, split and bundled
 *   LAB_VARIANTS=split node bench-vercel.ts 15
 *   LAB_IDLE_MIN=20 node bench-vercel.ts 15         # 3 deployments, a cold sample per 20 min idle
 *
 * ALWAYS the purus-projects scope, previews only (no --prod). Rows go to results-raw-2/vercel.jsonl.
 */
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const SCOPE = ['--scope', 'purus-projects'];
const VARIANTS = (process.env.LAB_VARIANTS ?? 'default,split,bundled').split(',');
const N = Number(process.argv[2] ?? 15);

function vercel(args: string[], cwd: string): string {
	return execFileSync('vercel', [...args, ...SCOPE], {
		cwd,
		encoding: 'utf8',
		maxBuffer: 1 << 26,
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

/** One timed request through `vercel curl` (it adds the deployment-protection bypass). */
function timed(
	url: string,
	path: string,
	cwd: string
): { status: string; ttfb_ms: number; total_ms: number; vercel_id: string } {
	const out = vercel(
		[
			'curl',
			path,
			'--deployment',
			url,
			'--',
			'-s',
			'-o',
			'/dev/null',
			'-D',
			'-',
			'-w',
			'\\n%{http_code} %{time_starttransfer} %{time_total}'
		],
		cwd
	);
	const lines = out.trim().split('\n');
	const [status, ttfb, total] = lines.at(-1)!.trim().split(' ');
	const id =
		lines
			.find((l) => /^x-vercel-id:/i.test(l))
			?.split(':')[1]
			?.trim() ?? '';
	return {
		status: status!,
		ttfb_ms: Math.round(Number(ttfb) * 1000),
		total_ms: Math.round(Number(total) * 1000),
		vercel_id: id
	};
}

await mkdir(join(ROOT, 'results-raw-2'), { recursive: true });
const made: [string, string][] = [];
/** LAB_IDLE_MIN=n: one deployment per variant, and a cold sample every n minutes of idle instead
 *  of a new deployment per sample (for a team on a deployments-per-day limit). */
const IDLE_MIN = Number(process.env.LAB_IDLE_MIN ?? 0);
const deployed = new Map<string, string>();
const deploy = (v: string, cwd: string): string => {
	const url = vercel(['deploy', '--prebuilt', '--yes'], cwd).trim().split('\n').pop()!.trim();
	made.push([url, cwd]);
	return url;
};
try {
	for (let i = 1; i <= N; i++) {
		if (IDLE_MIN > 0 && i > 1) await new Promise((r) => setTimeout(r, IDLE_MIN * 60_000));
		for (const v of VARIANTS) {
			const cwd = join(ROOT, 'builds', 'vercel-' + v);
			let url = deployed.get(v);
			if (url === undefined || IDLE_MIN === 0) url = deploy(v, cwd);
			if (IDLE_MIN > 0) deployed.set(v, url);
			const cold = timed(url, '/p/3', cwd);
			const warm = timed(url, '/p/3', cwd);
			const row = { round: i, variant: v, url, cold, warm };
			await appendFile(join(ROOT, 'results-raw-2', 'vercel.jsonl'), JSON.stringify(row) + '\n');
			console.log(JSON.stringify(row));
		}
	}
} finally {
	if (process.env.LAB_KEEP !== '1')
		for (const [url, cwd] of made) {
			try {
				vercel(['rm', url, '--yes'], cwd);
			} catch (e) {
				console.error('could not remove ' + url + ': ' + String(e).slice(0, 200));
			}
		}
}
