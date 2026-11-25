---
'@ogygia/image': minor
---

Remote images at build: `image({ remote: { hosts } })` lets `import.meta.og.image('https://…')`, a markdown image and a frontmatter URL on a listed host be fetched into the build cache (asked again on each build, a 304 keeps the copy, an offline build uses it and warns `image_remote_stale`) and become a file source like any other; an unlisted URL fails the build with `image_remote_host` (which replaces `image_remote_unsupported`), and a fetch with no copy that fails is `image_remote_failed`.
