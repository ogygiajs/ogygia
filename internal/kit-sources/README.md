# internal/kit-sources

Installs SvelteKit 3 (as `@sveltejs/kit3`) next to the Kit 2 the repository runs on, so a test can
read both. Nothing else lives here: just a `package.json`.

Internal. Never published. Its only reader is `packages/core/test/kit-shim-surface.test.ts`, which
checks that the Kit modules ogygia stands in for (the `$app/*` shims and the remote-functions
stubs) export every name each Kit major reads from them. A missing name breaks the production build.

Why a package of its own: Kit 3's peers want a newer Svelte. Installed anywhere else, they would move
the Svelte that ogygia and the apps resolve. As its own pnpm importer, its versions stay here. They
come from the `kit3` catalog in `pnpm-workspace.yaml`.

## Run

Nothing to run. To bump Kit 3, change the `kit3` catalog and run `pnpm install`, then run core's
tests:

```bash
pnpm --filter @ogygia/core test kit-shim-surface
```

Not to be confused with `internal/repro-kit3`, a whole Kit 3 app the e2e suite builds.
