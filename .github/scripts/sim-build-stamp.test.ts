// Every app CI builds for the simulator names its build (VITE_SIM_BUILD, the app's Kit version):
// left to Kit, the version is the build's moment, every file name that reads it moves, and a seed
// the scheduled run filed is another run anywhere else, its found test included (#2110).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = (name: string) =>
	readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');

/** Each step of `yaml` (its lines from `- name:` to the next), as text. */
function steps(yaml: string): string[] {
	const out: string[][] = [];
	for (const line of yaml.split('\n')) {
		if (/^\s+- (name|uses):/.test(line)) out.push([line]);
		else out.at(-1)?.push(line);
	}
	return out.map((lines) => lines.join('\n'));
}

test('each rules build of an app the simulator runs names its build', () => {
	let seen = 0;
	for (const name of ['dst.yml', 'e2e.yml'])
		for (const step of steps(workflow(name))) {
			if (!/OGYGIA_RULES/.test(step) || !/vite(\.js)? build/.test(step)) continue;
			seen++;
			assert.match(step, /VITE_SIM_BUILD:\s*'?v1'?/, `${name}: ${step.split('\n')[0].trim()}`);
		}
	assert.ok(seen >= 3, `the case it is for: rules builds found (${seen})`);
});
