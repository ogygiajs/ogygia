# internal/repro-kit3

A real SvelteKit 3 app on the packed `ogygia`, the way an app installs it from npm. It has a lake in
a `csr = false` layout (regions and a hole inside), serving one `csr = false` page and one
`csr = true` page. It also has a region with a remote form and the query it refreshes, a region whose
query argument is a custom transport type, and a region that reads `page`.

Internal. Never published. Its one user is `apps/palaestra/e2e/kit3.spec.ts`, which builds the
libraries, packs `ogygia`, copies this app to a temp folder outside the repo, installs it there, and
checks it both built and in dev.

## Not a workspace member

It is left out of `pnpm-workspace.yaml` on purpose. A workspace link would resolve ogygia's own Kit 2
install next to the app's Kit 3. That is also why:

- `ogygia` in `package.json` is the placeholder `OGYGIA_TARBALL`. The spec swaps in the packed
  tarball. Leave the placeholder as it is.
- Its versions are pinned inline, not from the catalogs (no catalog reaches a non-member).
- Do not run `pnpm install` in this folder.

## Run

```bash
pnpm --filter palaestra e2e kit3
```

Not to be confused with `internal/kit-sources`, which only installs Kit 3's source for a unit test.
