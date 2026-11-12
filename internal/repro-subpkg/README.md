# internal/repro-subpkg

A workspace package that ships a Svelte component with a region in it (`Toolbar.svelte` imports
`Bar.svelte` with `{ wake: 'load' }`), and does not depend on `ogygia` itself.

The ogygia transform adds imports of `ogygia/internal` to that component. Resolved from this
package, they would fail, because there is no `ogygia` here, and the app's build would break. The
plugin resolves them from ogygia's own package instead. This package keeps that working.

Internal. Never published. The palaestra depends on it and renders it at `/subpkg-island`;
`apps/palaestra/e2e/subpkg-island.spec.ts` checks that the page builds and the region wakes.

## Run

```bash
pnpm --filter palaestra e2e subpkg-island
```

Do not add `ogygia` to this package's dependencies. The missing dependency is the test.
