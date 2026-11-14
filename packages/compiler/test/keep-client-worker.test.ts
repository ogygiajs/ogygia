import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('node:worker_threads', async (load) => ({
	...(await load<typeof import('node:worker_threads')>()),
	isMainThread: false
}));

const { ogygia } = await import('../src/vite/index.ts');
const { keep_client_dir } = await import('../src/kit.ts');

let root = '';
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("a worker thread's build (Kit's analyse and prerender) neither injects the keep-client route nor sweeps it", async () => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-worker-')));
	for (const [rel, text] of [
		['src/lib/Counter.svelte', '<button>+</button>\n'],
		[
			'src/routes/+page.svelte',
			"<script>import Counter from '$lib/Counter.svelte' with { wake: 'visible' };</script><Counter />\n"
		],
		['src/routes/+layout.ts', 'export const csr = false;\n']
	]) {
		mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		writeFileSync(path.join(root, rel), text);
	}
	const call = async () => {
		const p = ogygia().find((x) => x.name === 'ogygia') as unknown as {
			config: { handler(c: object, e: object): Promise<unknown> };
		};
		await p.config.handler({ root, plugins: [] }, { command: 'build', mode: 'production' });
	};
	const keep = keep_client_dir(path.join(root, 'src/routes'));
	const before = process.listeners('exit').length;
	await call();
	expect(existsSync(keep)).toBe(false);
	expect(process.listeners('exit').length).toBe(before);
	// (the main thread's route, which the workers' builds still read)
	mkdirSync(keep, { recursive: true });
	writeFileSync(path.join(keep, '+layout.ts'), 'export const csr = true;\n');
	writeFileSync(path.join(root, 'src/routes/+layout.ts'), 'export const csr = true;\n');
	await call();
	expect(existsSync(keep)).toBe(true);
});
