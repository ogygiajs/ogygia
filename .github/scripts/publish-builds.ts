// EVERY PUBLISHED PACKAGE BUILDS ITSELF ON PUBLISH: a package that is not private has a
// `prepublishOnly` script that runs its build, so what npm gets is built at publish time (release.yml's
// publish job), never a stale or restored dist. Fails naming each package that has none. Run by plain
// node in e2e.yml's plan job.
//
//   node .github/scripts/publish-builds.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const missing: string[] = [];
for (const dir of readdirSync('packages')) {
	const file = join('packages', dir, 'package.json');
	if (!existsSync(file)) continue;
	const pkg = JSON.parse(readFileSync(file, 'utf8'));
	if (pkg.private) continue;
	const script: string = pkg.scripts?.prepublishOnly ?? '';
	if (!/\bbuild\b/.test(script)) missing.push(`  ${pkg.name} (${file})`);
}
if (missing.length) {
	console.error(
		`Each published package needs a \`prepublishOnly\` script that runs its build:\n${missing.join('\n')}`
	);
	process.exit(1);
}
console.log('every published package builds on publish');
