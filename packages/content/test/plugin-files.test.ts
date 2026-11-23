import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { content } from '../src/vite/index.ts';

type Definition = { build(b: unknown): void };
type Scan = { root: string; dirs?: string[]; files?: string[] };

it("content's plugin hands the scan its region components, so a server build knows their features before it fixes its own", () => {
	const [plugin] = content();
	const scans: Scan[] = [];
	const known: Record<string, unknown> = { root: '/app', files: (s: Scan) => scans.push(s) };
	const builder = new Proxy(known, {
		get: (target, key) => (typeof key === 'string' && key in target ? target[key] : () => ({}))
	});
	(plugin as unknown as Record<symbol, Definition>)[Symbol.for('ogygia.plugin')]!.build(builder);
	const lib = fileURLToPath(new URL('../src', import.meta.url));
	expect(scans).toEqual([
		{ root: path.dirname(lib), dirs: [path.join(lib, 'site', 'components')] }
	]);
});
