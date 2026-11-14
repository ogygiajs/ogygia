// CANARY: Rolldown's strictExecutionOrder deadlocks a SvelteKit 2 server build
// (rolldown/rolldown#11702): the async init wrappers it adds wait on each other around Kit's
// respond ↔ fetch import cycle, and Kit's post-build analysis imports the server output, so
// `vite build` stops at 0% CPU. jumpstart never sets it. This builds e2e/plain with the option on
// (JUMPSTART_STRICT=1, no jumpstart) and expects the build to hang: it is stopped after a timeout far
// above the plain build's own time, so the hang never stalls CI. The day the build finishes, this test
// fails, which says lazy module bodies are worth measuring again (internal/notes/design/server-chunks.md).
import { test, expect } from '@ogygia/tooling/e2e';
import { Fixture } from './fixture.ts';

const HANG_MS = 45_000;

test.skip(({ browserName }) => browserName !== 'chromium', 'no browser: one engine is enough');

test('strictExecutionOrder still deadlocks the SvelteKit 2 server build (rolldown#11702)', async () => {
	test.setTimeout(HANG_MS * 3);
	const app = new Fixture('plain');
	const plain = await app.build({ jumpstart: false });
	expect(plain.ok, plain.log).toBe(true);
	const strict = await app.build({ jumpstart: false, strict: true }, HANG_MS);
	expect(
		strict.timed_out,
		`the strictExecutionOrder build ${strict.ok ? 'finished' : 'failed without hanging'}: rolldown#11702 may be fixed. Check it, then measure lazy module bodies before using it.\n${strict.log.slice(-2000)}`
	).toBe(true);
});
