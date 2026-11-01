# Changesets

Releases are automated (`.github/workflows/release.yml`, the Changesets GitHub Action).

1. A PR that ships a change adds a changeset: `pnpm changeset`, pick the package or packages it
   changes and the bump (patch / minor / major), and write one line that says what changed for
   users. That line is the changelog entry; `@changesets/changelog-github` adds the PR link and its
   author. A PR with several independent fixes adds one changeset per fix.
2. Merged to `main`: the **Version packages** PR opens (or updates) with the new versions and
   changelogs. The packages form a linked group: only packages with changes are bumped, and they
   share the group's highest version.
3. Merging that PR publishes to npm under `latest`, creates the tags and GitHub releases, and only
   then moves the `latest` branch to the released commit.

## Branches

- `main` is where work lands. Its merges don't change anything public: the production sites
  (ogygiajs.dev and svelte.dev.ogygiajs.dev) deploy from the `latest` branch, so they show what is
  on npm, and change on a release.
- `latest` is moved only by the release workflow, after a publish succeeds. Nobody pushes to it.
- `0.8` keeps the 0.8.x line for patches. It releases from its own branch under the npm tag
  `lts-0.8` (`pnpm add ogygia@lts-0.8`), so a patch never takes `latest` from the current line.
  (npm refuses a tag that reads as a version range, like `0.8`.)

A PR into `main` merges by itself once CI is green when it carries the `ship` label
(`.github/workflows/ship.yml`); removing the label cancels.
