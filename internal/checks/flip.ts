/**
 * The flip gate (#512): proves a test guards a behavior before the comment that stated it goes.
 * It runs the command on the code as it is (it must pass), breaks the code on purpose (one exact
 * text swap, which must occur once), runs the command again (it must fail), and puts the code back,
 * whatever happens. It prints one markdown table row for the sweep PR's table.
 *
 *   node internal/checks/flip.ts --file packages/router/src/match.ts \
 *     --find 'a === b' --replace 'a !== b' --why 'two routes match the same path' \
 *     -- pnpm --filter @ogygia/router exec vitest run test/match.test.ts
 *
 * Exit code 0: the flip went red (the test guards it). 1: it stayed green, or the code as it is
 * already failed, or the swap did not apply.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const sep = process.argv.indexOf('--');
const file = arg('file');
const find = arg('find');
const replace = arg('replace');
const why = arg('why') ?? '';
const command = sep >= 0 ? process.argv.slice(sep + 1) : [];
if (!file || find === undefined || replace === undefined || command.length === 0) {
	console.error(
		'usage: flip.ts --file <path> --find <text> --replace <text> [--why <claim>] -- <command…>'
	);
	process.exit(2);
}

const original = readFileSync(file, 'utf8');
const count = original.split(find).length - 1;
if (count !== 1) {
	console.error(`flip: --find occurs ${count} times in ${file}; it must occur once`);
	process.exit(1);
}

function run(): { ok: boolean; tail: string } {
	const r = spawnSync(command[0], command.slice(1), { encoding: 'utf8', shell: false });
	const out = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`;
	const fail = out
		.split('\n')
		.map((l) => l.trim())
		.find((l) => /(FAIL|✗|×|✖|AssertionError|Error:|expected)/.test(l));
	return { ok: r.status === 0, tail: (fail ?? out.trim().split('\n').at(-1) ?? '').slice(0, 160) };
}

const restore = () => writeFileSync(file, original);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
	process.on(signal, () => {
		restore();
		process.exit(130);
	});

const before = run();
if (!before.ok) {
	console.error(`flip: the command fails on the code as it is: ${before.tail}`);
	process.exit(1);
}
let after: { ok: boolean; tail: string };
try {
	// A function replacer: a string one reads `$&` and `$$` as patterns, not text.
	writeFileSync(
		file,
		original.replace(find, () => replace)
	);
	after = run();
} finally {
	restore();
}

const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
console.log(
	`| ${cell(why)} | \`${cell(file)}\`: \`${cell(find)}\` → \`${cell(replace)}\` | ${after.ok ? 'STAYED GREEN' : `red: ${cell(after.tail)}`} |`
);
process.exit(after.ok ? 1 : 0);
