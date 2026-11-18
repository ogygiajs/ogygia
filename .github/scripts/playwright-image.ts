// THE PLAYWRIGHT IMAGE MATCHES PLAYWRIGHT (e2e.yml's `plan` job, every run): the browser jobs run in
// Playwright's own image, which carries one Playwright version's browsers and their system libraries,
// so nothing is installed at run time. Each image reference names that version and is pinned by
// digest, and the version is the one the lockfile resolves and the catalog pins. A Playwright bump
// without the image's (or an image without its digest) fails here, as does a Playwright container
// without the settings each red run taught (CONTAINER_NEEDS). Run by plain node.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE_RE = /mcr\.microsoft\.com\/playwright:([^\s'"]+)/g;
const PINNED_RE = /^v(\d+\.\d+\.\d+)-[a-z]+@sha256:[0-9a-f]{64}$/;
const LOCK_RE = /^ {2}playwright-core@([^:(\s]+):/gm;
const CATALOG_RE = /^catalog:\n((?:[ #].*\n|\n)*)/m;
const CATALOG_ENTRY_RE = /^ {2}'?@playwright\/test'?:\s*(\S+)\s*$/m;

/** What every Playwright container sets, and what goes wrong without it (e2e-slice.yml says more). */
const CONTAINER_NEEDS: ReadonlyArray<readonly [string, string]> = [
	['--user 1001', 'the runner’s user: the checkout stays its files and Firefox owns its HOME'],
	['--ipc=host', 'Docker’s 64 MB shared memory crashes Chromium'],
	['--init', 'nothing reaps orphans, and a server’s zombie child holds its stop forever'],
	[
		'NODE_OPTIONS: --dns-result-order=ipv4first',
		'the image names localhost ::1 first, and a server bound there refuses Node’s requests to 127.0.0.1'
	]
];

/** The lines of the YAML mapping the image key at `at` sits in (its siblings and their children). */
function container_block(text: string, at: number): string {
	const start = text.lastIndexOf('\n', at) + 1;
	const indent = /^ */.exec(text.slice(start))![0].length;
	const lines = text.slice(start).split('\n');
	const out = [lines[0]!];
	for (const line of lines.slice(1)) {
		if (line.trim() !== '' && /^ */.exec(line)![0].length < indent) break;
		out.push(line);
	}
	return out.join('\n');
}

/** Every problem with the Playwright images the workflows name, against the repo at `root`. */
export function image_drift(root: string): string[] {
	const problems: string[] = [];
	const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
	const locked = [...new Set([...lock.matchAll(LOCK_RE)].map((m) => m[1]!))];
	if (locked.length !== 1)
		problems.push(
			`pnpm-lock.yaml resolves ${locked.length} playwright-core versions (${locked.join(', ') || 'none'}): one image can carry only one`
		);
	const catalog =
		CATALOG_RE.exec(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'))?.[1] ?? '';
	const pinned = CATALOG_ENTRY_RE.exec(catalog)?.[1];
	if (pinned === undefined)
		problems.push(`pnpm-workspace.yaml: no '@playwright/test' in the catalog`);
	else if (locked.length === 1 && pinned !== locked[0])
		problems.push(
			`pnpm-workspace.yaml: the catalog's '@playwright/test' is ${pinned}, the lockfile resolves ${locked[0]}: pin the exact version`
		);
	const version = locked.length === 1 ? locked[0] : undefined;
	const dir = join(root, '.github', 'workflows');
	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
		const text = readFileSync(join(dir, file), 'utf8');
		for (const m of text.matchAll(IMAGE_RE)) {
			const ref = m[1]!;
			const block = container_block(text, m.index);
			for (const [needed, why] of CONTAINER_NEEDS)
				if (!block.includes(needed))
					problems.push(
						`.github/workflows/${file}: the Playwright container has no \`${needed}\` (${why})`
					);
			const pin = PINNED_RE.exec(ref);
			if (!pin)
				problems.push(
					`.github/workflows/${file}: mcr.microsoft.com/playwright:${ref} is not v<version>-<distro>@sha256:<digest>`
				);
			else if (version !== undefined && pin[1] !== version)
				problems.push(
					`.github/workflows/${file}: the image is Playwright ${pin[1]}, the lockfile resolves ${version}: move the image's tag and digest with it`
				);
		}
	}
	return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const problems = image_drift(new URL('../..', import.meta.url).pathname);
	for (const p of problems) console.error(`::error::${p}`);
	if (problems.length > 0) process.exit(1);
	console.log('The Playwright images match the lockfile and the catalog.');
}
