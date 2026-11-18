// THE PLAYWRIGHT IMAGE MATCHES PLAYWRIGHT (e2e.yml's `plan` job, every run): the browser jobs run in
// Playwright's own image, which carries one Playwright version's browsers and their system libraries,
// so nothing is installed at run time. Each image reference names that version and is pinned by
// digest, and the version is the one the lockfile resolves and the catalog pins. A Playwright bump
// without the image's (or an image without its digest) fails here. Run by plain node.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE_RE = /mcr\.microsoft\.com\/playwright:([^\s'"]+)/g;
const PINNED_RE = /^v(\d+\.\d+\.\d+)-[a-z]+@sha256:[0-9a-f]{64}$/;
const LOCK_RE = /^ {2}playwright-core@([^:(\s]+):/gm;
const CATALOG_RE = /^catalog:\n((?:[ #].*\n|\n)*)/m;
const CATALOG_ENTRY_RE = /^ {2}'?@playwright\/test'?:\s*(\S+)\s*$/m;

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
		for (const m of readFileSync(join(dir, file), 'utf8').matchAll(IMAGE_RE)) {
			const ref = m[1]!;
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
