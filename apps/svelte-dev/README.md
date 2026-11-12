# svelte-dev

A rebuild of the svelte.dev docs and blog on ogygia, as a stress test. The content is the real
thing: `import.meta.og.loader.git()` reads the Svelte, SvelteKit, CLI and AI-tools docs, and the
blog, straight from their public `sveltejs/*` repos (`src/lib/site.server.ts`). That is a large,
real corpus with twoslash hovers, JS-to-TS code variants and admonitions, all plugged in as values
through `@ogygia/content`.

Internal. Never published. `vercel.json` deploys it from `latest` and `main`, building the
libraries it needs first.

## Run

```bash
pnpm build:lib                         # it uses the workspace ogygia and @ogygia/content
pnpm --filter svelte-dev dev           # http://localhost:5283
pnpm --filter svelte-dev build
pnpm --filter svelte-dev test          # vitest: the JS-to-TS, twoslash-strip and moved-pages helpers
pnpm --filter svelte-dev check         # svelte-check
```

The git loader fetches the upstream repos, so a dev start or build needs the network. When upstream
moves a page and old links still point at it, add the move to `src/lib/moved-pages.ts`, with a test.
