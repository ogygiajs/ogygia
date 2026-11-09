# Changesets

Releases are automated (`.github/workflows/release.yml`, the Changesets GitHub Action).

1. A PR that ships a change adds a changeset: `pnpm changeset`, pick the package or packages it
   changes and the bump (patch only on this line), and write one line that says what changed for
   users. That line is the changelog entry; `@changesets/changelog-github` adds the PR link and its
   author. A PR with several independent fixes adds one changeset per fix.
2. Merged to `lts-0.12`: the **Version packages** PR opens (or updates) with the new versions and
   changelogs.
3. Merging that PR publishes to npm under the tag `lts-0.12` (`pnpm add ogygia@lts-0.12`), and
   creates the tags and GitHub releases.

This branch, `lts-0.12`, is the 0.12.x line, kept for patches. Current development is on `main`,
which publishes under `latest`. (npm refuses a tag that reads as a version range, like `0.12`.)
