# internal/repro-hole-css-kit

A tiny component kit, shaped like a design-system package: its `./components` export is a TypeScript
barrel (`components.ts`) that re-exports a few Svelte components. One of them (`KitUnused`) is never
imported.

Internal. Never published. The palaestra depends on it for `/hole-css`, and
`apps/palaestra/e2e/hole-css.spec.ts` checks that page. A server hole there imports kit components by
name through the barrel, and holds a region whose flyout uses more of them. The hole's CSS must carry
exactly the components it uses, and none of the rest.

## Run

Nothing to run here. Run the spec:

```bash
pnpm --filter palaestra e2e hole-css
```

Keep `KitUnused` unused. It is how the spec proves the CSS is not "everything in the barrel".
