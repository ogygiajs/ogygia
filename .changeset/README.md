# Changesets

Releases are automated (`.github/workflows/release.yml`, the Changesets GitHub Action).

1. A PR that ships a change to `ogygia` adds a changeset: `pnpm changeset`, pick `ogygia` and the bump
   (patch / minor / major), and write one line that says what changed for users. That line is the
   changelog entry; `@changesets/changelog-github` adds the PR link and its author.
2. Merged to `lts-0.8`: the **Version packages** PR opens (or updates) with the new version and
   changelog.
3. Merging that PR publishes `ogygia` to npm under the tag `lts-0.8` (`pnpm add ogygia@lts-0.8`), and
   creates its tag and GitHub release.

This branch, `lts-0.8`, is the 0.8.x line, kept for patches. Current development is on `main`, which
publishes under `latest`.
