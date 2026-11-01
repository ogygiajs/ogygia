import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { postrender } from '@ogygia/postrender/vite';
import { flags } from '@ogygia/flags/vite';
import { federation } from '@ogygia/federation/vite';
import { router } from '@ogygia/router/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// `postrender()` = the shell's pages are stored on their first request. Its anonymous home bakes a
	// static dash widget and is stored; a publish or deploy on the dash team clears it via a cross-app
	// thaw notice (federation v2). The /cms/* mount pages read the shell's decided flags, so they stay
	// per-request.
	plugins: [ogygia(), postrender(), flags(), federation(), router(), sveltekit()]
});
