// The Kit 3 fixture (e2e/app-kit3), copied to a folder of its own with its node_modules linked
// entry by entry, so each test's build cache and output are its alone.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_ENV } from '../src/handoff.ts';

const FIXTURE = fileURLToPath(new URL('../e2e/app-kit3', import.meta.url));
const COPIED: readonly string[] = ['src', 'package.json', 'vite.config.ts'];

function link_modules(from: string, to: string): void {
	fs.mkdirSync(to, { recursive: true });
	for (const name of fs.readdirSync(from)) {
		if (name.startsWith('.')) continue;
		const entry = path.join(from, name);
		if (name.startsWith('@')) link_modules(entry, path.join(to, name));
		else fs.symlinkSync(fs.realpathSync(entry), path.join(to, name));
	}
}

/** A fresh copy of the Kit 3 fixture, in a folder of its own. */
export function kit3_app(): string {
	const app = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-kit3-'));
	for (const name of COPIED)
		fs.cpSync(path.join(FIXTURE, name), path.join(app, name), { recursive: true });
	link_modules(path.join(FIXTURE, 'node_modules'), path.join(app, 'node_modules'));
	return app;
}

/** The environment a fixture build runs in: this process's, with no handoff of its own. */
export function build_env(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env[BUILD_ENV];
	return env;
}

/** `vite build --watch` of a fixture copy, with what it logged. */
export class Kit3Watch {
	static readonly ADAPTED = '✔ done';

	log = '';
	readonly #child: ChildProcess;

	constructor(app: string) {
		this.#child = spawn('node', ['node_modules/vite/bin/vite.js', 'build', '--watch'], {
			cwd: app,
			env: build_env()
		});
		this.#child.stdout?.on('data', (d: Buffer) => (this.log += d.toString()));
		this.#child.stderr?.on('data', (d: Buffer) => (this.log += d.toString()));
	}

	/** Once `found()` holds of the log; rejects if the watch stops first. */
	until(found: () => boolean): Promise<void> {
		const child = this.#child;
		return new Promise((resolve, reject) => {
			const seen = (): void => {
				if (!found()) return;
				child.stdout?.off('data', seen);
				child.stderr?.off('data', seen);
				resolve();
			};
			child.once('exit', () =>
				reject(new Error(`the watch build stopped:\n${this.log.slice(-4000)}`))
			);
			child.stdout?.on('data', seen);
			child.stderr?.on('data', seen);
			seen();
		});
	}

	/** How many times the adapter has run. */
	adapted(): number {
		return this.log.split(Kit3Watch.ADAPTED).length - 1;
	}

	async stop(): Promise<void> {
		if (this.#child.exitCode !== null || this.#child.signalCode !== null) return;
		const exited = new Promise<void>((resolve) => this.#child.once('exit', () => resolve()));
		this.#child.kill();
		await exited;
	}
}

/** The `<img>` URLs of one page the fixture's adapter wrote. */
export function image_srcs(app: string, page: string): string[] {
	const html = fs.readFileSync(path.join(app, 'build', page), 'utf8');
	return [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]!);
}
