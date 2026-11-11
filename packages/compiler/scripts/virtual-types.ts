// Write the virtual-module table's generated files: the value entries' export names
// (src/compiler/virtual/value-names.ts, probed from their `from`), core's virtual/<realm>.d.ts and
// the constants' globals, core's virtual/constants.d.ts. The declarations point at core's contract
// only. Runs before every compiler build; the tests fail while a committed copy is stale
// (test/virtual-types.test.ts).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../src/compiler/virtual/core.ts';
import {
	virtual_types,
	constant_types,
	probe_value_names,
	value_names_source
} from '../src/compiler/virtual/types.ts';

const names = probe_value_names(core.CORE_VIRTUALS, core.CORE_PROBE.app, core.CORE_PROBE.leg);
const names_file = fileURLToPath(
	new URL('../src/compiler/virtual/value-names.ts', import.meta.url)
);
fs.writeFileSync(names_file, value_names_source(names));
// (the formatter's layout, so the committed file and a fresh one compare equal)
execFileSync('pnpm', ['exec', 'oxfmt', names_file], { stdio: 'ignore' });
console.log('wrote src/compiler/virtual/value-names.ts');

const dir = fileURLToPath(new URL('../../core/virtual/', import.meta.url));
fs.mkdirSync(dir, { recursive: true });
for (const [realm, text] of Object.entries(virtual_types(core, names))) {
	fs.writeFileSync(path.join(dir, `${realm}.d.ts`), text);
	console.log(`wrote core/virtual/${realm}.d.ts`);
}
fs.writeFileSync(path.join(dir, 'constants.d.ts'), constant_types(core));
console.log('wrote core/virtual/constants.d.ts');
