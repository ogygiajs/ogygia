import { defineConfig } from 'tsdown';

// One output file per source file (`unbundle`): the Vite plugin runs from `dist/vite/` in plain node,
// and the source structure is kept. No `library()` here: its `import.meta.resolve('./x.ts')` rewrite
// would reach the build messages, which quote that call as text.
export default defineConfig({
	entry: ['src/**/*.ts', '!src/**/*.d.ts'],
	format: 'esm',
	platform: 'neutral', // the plugin runs in node; `./ids` also loads in the browser
	unbundle: true,
	dts: true,
	clean: true,
	treeshake: false,
	deps: {
		// never inline: peers, dependencies and the app's own specifiers
		neverBundle: [
			/^@ogygia\//,
			'svelte',
			/^svelte\//,
			/^@sveltejs\/kit(\/|$)/,
			'devalue',
			'magic-string',
			'estree-walker',
			'tinyglobby',
			/^vite(\/|$)/,
			/^rolldown(\/|$)/,
			'typescript',
			/^node:/,
			/^virtual:/,
			/^ogygia(:|\/|$)/,
			/^\$app\//,
			/\.svelte$/
		]
	}
});
