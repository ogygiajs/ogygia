// The shipped build keeps `#region-server` a package import: the app's bundler picks the browser
// stand-in for the client and the server reads for SSR. A build that inlined it to a file path would
// put the server reads (and their server-only virtual modules) into every browser bundle.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = path.join(import.meta.dirname, '../dist');

function js_files(dir: string): string[] {
	const out: string[] = [];
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		if (fs.statSync(p).isDirectory()) out.push(...js_files(p));
		else if (name.endsWith('.js')) out.push(p);
	}
	return out;
}

const REGION_SERVER_FILE_RE = /from\s*["'][./]+region-server(\.browser)?\.js["']/;

describe('the shipped build and #region-server', () => {
	it('no built module imports region-server by file path; its importers keep the package import', () => {
		const by_path: string[] = [];
		let by_import = 0;
		for (const f of js_files(DIST)) {
			const code = fs.readFileSync(f, 'utf8');
			if (REGION_SERVER_FILE_RE.test(code)) by_path.push(path.relative(DIST, f));
			if (code.includes('"#region-server"') || code.includes("'#region-server'")) by_import++;
		}
		expect(by_path).toEqual([]);
		expect(by_import).toBeGreaterThan(0);
	});
});
