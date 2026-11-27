/**
 * How long a static build takes, cold and warm, and how many image files it makes: timed, so
 * reported and never gated (the counted gate is test/build-counts.test.ts).
 *
 *   node packages/image/bench/build-time.ts                       # the e2e fixture, prerendered
 *   node packages/image/bench/build-time.ts <app> --env BLOG_STATIC=1 --images build-static/_app/immutable/og
 *   node packages/image/bench/build-time.ts <app> --astro         # an Astro site, for comparison
 *
 * Options: `--runs <n>` (5), `--env KEY=VALUE` (repeatable), `--images <dir>` (the image files'
 * folder, relative to the app). A cold build first removes the build cache (`node_modules/.ogygia`;
 * Astro: `dist`, `.astro`, `node_modules/.astro`); a warm one keeps what the build before it left.
 * Each phase prints its median, min and max wall time, the image files and their bytes, and the
 * median time of the image writer (`@ogygia/image:load writeBundle`, as the build's plugin timings
 * list it; `-` when they do not list it).
 *
 * @packageDocumentation
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

interface Target {
	app: string;
	command: readonly string[];
	env: Record<string, string>;
	cold: readonly string[];
	images: string;
	only: RegExp | null;
}

interface Run {
	ms: number;
	writer_ms: number | null;
	files: number;
	bytes: number;
}

const FIXTURE = fileURLToPath(new URL('../e2e/app', import.meta.url));
const IMAGE_FILE_RE = /\.(avif|webp|png|jpe?g|gif|svg)$/i;
const WRITER_RE = /@ogygia\/image:load writeBundle \(\d+%, ([\d.]+)(m?s),/;

function target_of(args: readonly string[]): { target: Target; runs: number } {
	let app = FIXTURE;
	let runs = 5;
	let astro = false;
	let images = '';
	const env: Record<string, string> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === '--runs') runs = Number(args[++i]);
		else if (arg === '--astro') astro = true;
		else if (arg === '--images') images = args[++i] ?? '';
		else if (arg === '--env') {
			const [key, ...value] = (args[++i] ?? '').split('=');
			env[key!] = value.join('=');
		} else app = path.resolve(arg);
	}
	if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs takes a whole number above 0');
	if (app === FIXTURE && !astro) env.IMAGE_E2E_STATIC ??= '1';
	const target: Target = astro
		? {
				app,
				command: ['node_modules/astro/bin/astro.mjs', 'build'],
				env,
				cold: ['dist', '.astro', 'node_modules/.astro'],
				images: images || 'dist/_astro',
				only: IMAGE_FILE_RE
			}
		: {
				app,
				command: ['node_modules/vite/bin/vite.js', 'build'],
				env,
				cold: ['node_modules/.ogygia'],
				images: images || 'build/static/_app/immutable/og',
				only: null
			};
	return { target, runs };
}

function files_in(dir: string, only: RegExp | null): { files: number; bytes: number } {
	let files = 0;
	let bytes = 0;
	let names: string[];
	try {
		names = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' });
		// oxlint-disable-next-line ogygia/no-silent-failures -- no folder: the build made no image files
	} catch {
		return { files, bytes };
	}
	for (const name of names) {
		if (only && !only.test(name)) continue;
		const stat = fs.statSync(path.join(dir, name));
		if (!stat.isFile()) continue;
		files++;
		bytes += stat.size;
	}
	return { files, bytes };
}

function build(target: Target, cold: boolean): Run {
	if (cold)
		for (const dir of target.cold)
			fs.rmSync(path.join(target.app, dir), { recursive: true, force: true });
	const start = process.hrtime.bigint();
	const res = spawnSync('node', target.command, {
		cwd: target.app,
		env: { ...process.env, ...target.env },
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024
	});
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	const out = stripVTControlCharacters(`${res.stdout}${res.stderr}`);
	if (res.status !== 0) throw new Error(`the build failed (${res.status}):\n${out.slice(-4000)}`);
	const writer = WRITER_RE.exec(out);
	const writer_ms = writer ? Number(writer[1]) * (writer[2] === 's' ? 1000 : 1) : null;
	return { ms, writer_ms, ...files_in(path.join(target.app, target.images), target.only) };
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(2)} s`;

function row(phase: string, runs: readonly Run[]): string {
	const times = runs.map((r) => r.ms);
	const writers = runs.flatMap((r) => (r.writer_ms === null ? [] : [r.writer_ms]));
	const last = runs[runs.length - 1]!;
	return [
		phase,
		seconds(median(times)),
		seconds(Math.min(...times)),
		seconds(Math.max(...times)),
		String(last.files),
		`${(last.bytes / 1024 / 1024).toFixed(1)} MB`,
		writers.length ? seconds(median(writers)) : '-'
	].join(' | ');
}

const { target, runs } = target_of(process.argv.slice(2));
const cold: Run[] = [];
const warm: Run[] = [];
for (let i = 0; i < runs; i++) cold.push(build(target, true));
for (let i = 0; i < runs; i++) warm.push(build(target, false));
console.log(`${target.app}, ${runs} runs each`);
console.log('phase | median | min | max | image files | image bytes | image writer');
console.log('--- | --- | --- | --- | --- | --- | ---');
console.log(row('cold', cold));
console.log(row('warm', warm));
