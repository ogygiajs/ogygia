---
'@ogygia/image': minor
---

Remote images at request: `remoteImage(url, { width, height, alt?, version? })` makes a descriptor of an image a server load learns per request (a CMS entry's); the image endpoint fetches its URL (signed into the file's URL) under `image({ remote: { hosts, maxBytes, timeout } })`, one fetch per URL, and answers its files `public, max-age=<rest of the maxAge window>, stale-while-revalidate=<maxAge>`, never immutable; refusals are 404 (unlisted host, a redirect off the list, or a host listed only by `*.` that resolves to a private address, a rule the build's fetch now follows too), 413, 504 and 502, each `no-store` and said as `image_remote_refused`; a prerendered page's `remoteImage()` is fetched by the build and its files named by the bytes; `cloudflare()` links name the whole URL, and `image_vercel_config` now requires `images.remotePatterns` for each `remote.hosts` entry (type `VercelRemotePattern`).
