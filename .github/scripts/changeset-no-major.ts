// NO MAJOR BEFORE 1.0 (e2e.yml's `plan` job, every run): ogygia's packages are one linked release
// group below 1.0.0, so one `major` in a changeset would take every package to 1.0.0. A breaking
// change is `minor`, its line saying it breaks and what to use instead. Fails naming each changeset
// that declares `major` for a package still below 1.0.0. Run by plain node.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;

/** Each workspace package's name → version (packages/* and apps/*). */
function versions(): Map<string, string> {
	const out = new Map<string, string>();
	for (const group of ['packages', 'apps']) {
		const dir = join(root, group);
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			const file = join(dir, name, 'package.json');
			if (!existsSync(file)) continue;
			const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
			if (pkg.name && pkg.version) out.set(pkg.name, pkg.version);
		}
	}
	return out;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const BUMP_RE = /^\s*['"]?([^'":]+)['"]?\s*:\s*(major|minor|patch)\s*$/;

const known = versions();
const bad: string[] = [];
const dir = join(root, '.changeset');
for (const file of readdirSync(dir)) {
	if (!file.endsWith('.md') || file === 'README.md') continue;
	const front = FRONTMATTER_RE.exec(readFileSync(join(dir, file), 'utf8'))?.[1] ?? '';
	for (const line of front.split('\n')) {
		const m = BUMP_RE.exec(line);
		if (!m || m[2] !== 'major') continue;
		const version = known.get(m[1]!.trim()) ?? '0.0.0';
		if (Number(version.split('.')[0]) < 1)
			bad.push(`.changeset/${file}: '${m[1]}' is ${version}, so \`major\` would release 1.0.0`);
	}
}

if (bad.length) {
	console.error(
		`A changeset declares \`major\` below 1.0.0. Use \`minor\`, and say in its line that it breaks and what to use instead:\n${bad.map((b) => `  ${b}`).join('\n')}`
	);
	process.exit(1);
}
console.log('changesets: no major below 1.0.0');
