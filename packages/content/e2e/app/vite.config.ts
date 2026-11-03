import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { ogygia } from 'ogygia/vite';
import { content, preprocess, extensions } from '@ogygia/content/vite';
import { defineConfig } from 'vite';

/** SvelteKit's config (Kit 3: passed to `sveltekit()`; a `svelte.config.js` is an error). A function:
 *  `extensions()` / `preprocess()` read the `content({ markdown })` call, so it runs after it. */
const kit = () => ({
	adapter: adapter(),
	// Markdown content (`.svx`) so the content-css spec can exercise the content-body CSS path.
	extensions: extensions(),
	preprocess: [vitePreprocess(), ...preprocess()],
	compilerOptions: {
		experimental: { async: true }
	},
	experimental: { remoteFunctions: true },
	// Kit's own inline-vs-link number, which ogygia's region CSS obeys too: a region sheet under it
	// ships as `<style data-ogygia-region-css>` instead of a blocking `<link>`
	inlineStyleThreshold: 400
});

// @ogygia/content's e2e fixture app: the markdown pipeline (stock defaults) so the `.svx` fixture
// behind /content-css compiles — that spec guards content-body scoped CSS shipping to a csr=false page.
export default defineConfig({
	plugins: [ogygia(), content({ markdown: {} }), sveltekit(kit())]
});
