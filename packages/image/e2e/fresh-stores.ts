// Each e2e mode starts with no file store (a webServer command's first step, run in the app): the
// build cache's files and its own live store (the mode's own TMPDIR, playwright.config.ts `served`).
// A store another mode or an earlier run filled would hand back the cards and files it drew, so a
// broken draw would pass in every mode after the first.
import fs from 'node:fs';
import path from 'node:path';

const tmp = process.env.TMPDIR;
if (tmp === undefined || !tmp.includes('ogygia-image-e2e'))
	throw new Error(`fresh-stores: TMPDIR is no e2e mode's own folder (${String(tmp)})`);
fs.rmSync(path.resolve('node_modules/.ogygia/image/files'), { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
