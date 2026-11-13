import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { postrender } from '@ogygia/postrender/vite';
import { flags } from '@ogygia/flags/vite';
import { router } from '@ogygia/router/vite';
import { dataShake } from '@ogygia/data-shake/vite';
import { defineConfig } from 'vite';
import { later_answer } from 'postrender-e2e-later-answer/vite';

export default defineConfig({
	// The postrender fixture: `postrender()` = the switch (hooks.server.ts adds `postrender.handle()`,
	// with edge adapters at the emulators when ../postrender.spec.ts boots them). `flags()`: the
	// /flagged page reads one, and that read must refuse the store. `router()`: the /r/* pages are a
	// server-router table in hooks.server.ts. `later_answer()`: a plugin after postrender that answers
	// some page requests itself (../later-answer). `dataShake()`: a hole whose tree reads no page.data
	// skips the page look-up, so a stored shell renders once (S6, S13).
	plugins: [ogygia(), postrender(), flags(), router(), dataShake(), later_answer(), sveltekit()]
});
