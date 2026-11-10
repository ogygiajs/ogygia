// Write the per-realm `.d.ts` files of the virtual-module table: packages/core/virtual/<realm>.d.ts.
// Run after changing an entry's `types` (test/virtual-types.test.ts fails while they are stale).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_VIRTUALS } from '../src/compiler/virtual/core.ts';
import { virtual_types } from '../src/compiler/virtual/types.ts';

const dir = fileURLToPath(new URL('../virtual/', import.meta.url));
fs.mkdirSync(dir, { recursive: true });
for (const [realm, text] of Object.entries(virtual_types(CORE_VIRTUALS))) {
	fs.writeFileSync(path.join(dir, `${realm}.d.ts`), text);
	console.log(`wrote virtual/${realm}.d.ts`);
}
