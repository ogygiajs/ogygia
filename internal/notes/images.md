# Images — spec v3: "pages ask, the endpoint settles"

Part one is what `@ogygia/image` is and does now. Part two is what comes next, as design. The user
docs are `apps/docs/src/content/docs/10-content/07-images`; the package README and both AI skills
say the same in short.

## The one idea

The build does not encode sources. Pages ask for files. A file is a **recipe**: a source, a width
and height, a format, a crop, a quality, the source's operations. On a live server and in dev the
recipe is a **signed URL**, and whoever asks first makes the file (the dev server, a visitor); an
image is then a region whose output is pixels, through the same signed door as deferred regions
(same key, same signer, its own domain). Every file the **build** makes (a prerendered page's, a
warmed preset's) is instead a static file named by its recipe alone, under Kit's immutable folder:
the same name in every build, with no key.

---

# Part one: built

## 1. Packaging

`@ogygia/image` is a plugin package. `image({ presets, … })` from `@ogygia/image/vite` is listed
beside `ogygia()` and before `sveltekit()`; `<Img>`, `getImage` and `isImage` come from
`@ogygia/image`; types for the macro from `@ogygia/image/types`. `ogygia` itself depends on core and
compiler only, so images are not an `ogygia/image` subpath. sharp is a peer the app installs
(explicit over implicit: the app picks its version and platform binary). The Vite side loads it on
first use (`vite/encoder.ts` `pixels()`), so the plugin loads without it and `configResolved` fails
coded (`image_sharp_missing`) when the app does not list and install it, or, for a server build
that makes files on request, does not list it in `dependencies` (adapter-node bundles everything
else, and a bundled sharp cannot find its binary). The check is one `decisions()` table
(`ENCODER`): runtime (dev, client, prerendered, server, edge) × installed × listed. Edge adapters
keep the `image_adapter_no_encoder` warning. On a server only the endpoint loads sharp (a lazy
import), so a server that never serves an image never loads it. e2e `server` mode runs the
adapter's own output (`node build`, NODE_PATH unset) to hold this.

The plugin has a **server realm** (`definePlugin({ server })`, `defineServer({ setup, request })`)
that ogygia's handle starts: `setup` hands `<Img>` the minter, `request` is the endpoint.

## 2. Three moments

1. **Compile.** `import.meta.og.image(src, opts?)` (literal arguments, read from the AST; `.glob()`
   for many), a markdown `![]()` and a frontmatter `./x.jpg` register a **source**: its id (a hash
   of its bytes only; ops, quality and position are in each file's head), its shown size (EXIF orientation and ops applied), whether it
   moves, a ~100 B WebP placeholder, and the original shipped as an ordinary hashed asset
   (`?no-inline`). Nothing is encoded. The plan is kept in the build cache by id.
2. **Render.** `<Img>` (and `getImage()` for a CSS background or an `og:image`) turns a preset or its
   own props (`layout`, `width`, `height`, `aspect`, `position`, `sizes`, `priority`, `placeholder`,
   `morph`) into the candidate files, and names each by a URL. Fixed: `[w, 2w]`. Constrained: the
   ladder below `2w`, plus `w` and `2w`. Full width: the ladder. All capped at the widest the source
   covers. A ladder step within a tenth of a named width (`w`, `2w`, the widest) is left out. Crops are real files (fit cover at the position).
3. **Settle.** The endpoint verifies the URL, reads the original with Kit's `read()`, encodes it
   with sharp and keeps the file in the store.

## 3. The descriptor

`{ id, src, width, height, format, ph?, animated?, quality?, ops?, warm?, alt?, twins? }`. Plain
JSON: it crosses island props, refs, devalue, freeze and federation unchanged. No list of files:
render decides those. `warm` lists the presets the build made ahead for this source (§7). `twins`
are the macro's dark and art files, each `{ media, of, theme? }` with a full descriptor of its own
(its own placeholder), one level deep (§15).

## 4. URLs

- **Signed:** `<base>/__ogygia__/i/<sig>/<id>-<w>x<h>[-q<q>][-p<position>][-s][-o<ops>]/<original asset
  path>.<ext>` (`-s`: the first frame only, a moving source's still, §15). Path only (a prerendered file has no query, and Kit's prerender throws on a query
  read). The format is the extension, so a static host types the file by it. The original's
  hashed asset name is in the path, so a build's URLs are content-addressed. `sig` is `app.sign`
  over `image|<path>` (the app's region key, in the plugin's own domain, no expiry), checked with
  `app.verify`. A refusal is 403 with `x-ogygia-deny: sig` and `x-ogygia-key: <fingerprint>`, so a
  key change across deploys is visible rather than an opaque 403.
- **Built:** `<assets or base>/<appDir>/immutable/og/<id>-<w>x<h>[-q…][-p…][-o…].<ext>`, a static
  file the build wrote (§6): every file a prerendered page names, and a warmed preset's (§7).
  Unsigned (only the build can put a file there), so stable across builds with no
  `OGYGIA_SECRET`, and served as a file by every adapter (Kit's immutable folder, kept forever).
  The name is `recipe.ts` `built_file`; its `<head>.<ext>` (`recipe_file`) is also every store's
  key: the id names the source by content, so the original's path is not needed in it.

Why the endpoint is not under `<appDir>/immutable/og/`: Kit answers any path under its `appDir`
that is not a file with a 404 before any hook runs (Kit 2.70 `runtime/server/respond.js`, the
`resolved_path.startsWith('/' + app_dir)` branch), in dev, in the prerender and on every adapter.
So a file the endpoint makes on request cannot live there; a file the build made can.

`base`, `assets` and `appDir` are read once at config time from the values Kit's Vite plugin
defines, and handed to the server realm and `<Img>` in the plugin's config module
(`image_no_kit` without SvelteKit).

## 5. The endpoint

- dev: the browser asks, the dev server makes the file.
- a live server: the first visitor's request makes the file; a CDN keeps it after.
- prerender: never asked. A prerendered page names built files only (§6).

An original must sit under `src/`, outside `src/lib/server/` and test files (`image_outside_src`):
Kit's `read()` only serves the server's assets, and those come from modules the server graph
imports, never from `.svelte` components. The server realm imports a virtual module whose eager
`import.meta.glob` names every image under `src/` (minus those folders), which makes each one a
server asset. The endpoint also refuses a signed recipe whose original is not in that set (404).

A runtime that cannot load sharp answers a coded 500 (`image_no_encoder`, said once), and a build
for an adapter whose runtime has no native modules (Cloudflare, Deno, edge) warns
(`image_adapter_no_encoder`). A failed encode is `image_settle_failed` and a 500 no cache keeps.
At most four encodes run at once (a queue), with sharp's input pixel limit on.

## 6. The store, and the build's files

One **store** keeps every made file by its key (`recipe_file`: `<head>.<ext>`), streamed back on the
next ask. The head starts with the source id, `source_id(bytes)`: a hash of the original's bytes
and the encoder version alone (settings such as `placeholder` key the plan cache, not the id;
quality, crop and ops are in the head). Whoever makes a file (the endpoint's flights, the build's
writer) hashes the original it read and refuses a mismatch, so a store entry is always made from
the bytes its name names: an original edited after a page named its files answers 404
(`image_source_changed`), never its new pixels under the old name (which a build would then ship,
`immutable`, for good). One `FileStore` per folder per process (`FileStore.shared`), so its size
cap holds for a dev server's whole run; a found file is touched (at most once a day) so a month's
age is a month unused.

- the build and the dev server use the build cache (`node_modules/.ogygia/image/files/<encoder
  version>-<libvips>`), handed to their processes in the environment (Kit's prerender runs in a
  worker thread, which inherits it), so a CI run that keeps the cache encodes nothing twice;
- a live server uses `<tmp>/ogygia-image-<uid>/<version>/`, made `0700` and checked to be a real
  folder this user owns (else `image_store_unsafe`, and nothing is kept: a folder another user made
  first could hand out bytes under URLs browsers keep forever). Other versions' folders are
  removed at start, files unused for a month too. The endpoint answers 405 to any method but GET
  and HEAD.

**The build's files.** In Kit's prerender the server realm signs nothing: the minter notes each
recipe a page names (its unsigned path, so the original can be found) in a file of the build's run
(disk, not memory: the prerender is a worker), starts its file at once (encodes run side by side),
and names it `<mark><built URL>`. The mark is `//<16 hex>.ogygia.invalid`, random per build and in
the build's handoff: Kit's crawler follows every root-relative `href`, `src`, `srcset` and meta
`content`, and would ask for the built URL under `<appDir>` before the file exists, which Kit
answers 404 before any hook (and fails the prerender); a `//` URL is never followed (Kit's
`resolve` keeps it as is, `is_root_relative` is false). An absolute `paths.assets` URL is not
followed either, so it carries no mark.

ONE writer, the server build's `writeBundle` (`order: 'post'`: after Kit's, which runs the client
build and the prerender; before the adapter, in `closeBundle`), makes every file the build owns:
the warmed sources the server build read, and every noted recipe. Each goes to
`<output>/client/<appDir>/immutable/og/`, which every adapter copies and serves as files (so they
need not be in Kit's prerendered list). Then the mark is removed, byte for byte, from every file
under `<output>/prerendered/` (pages, data, dependencies). A mark made absolute (`http:` or
`https:` + mark, the scheme at a URL's start: the page did `new URL(src, page.url)`) becomes Kit's
prerender origin, which is what `page.url` named while it prerendered; the server realm notes it
from the first prerender request (`origin.txt` beside the notes). With Kit's default origin
(`http://sveltekit-prerender`) the build cannot know the site's, and fails (`image_mark_left`).
The mark's host left in another form (escaped, encoded) cannot be pointed at a file:
`image_mark_left`, naming the file. A file that cannot be made: `image_unsettled`, naming the made
URL and the source file.

After the writer, the handoff says so (`written` = the client app folder, no notes, no mark): a
page rendered later in the same process tree (an adapter's SPA fallback, which Kit 2.70 renders
`ssr: false` anyway) names the files as written, or the original where no prerendered page asked
for that file, and notes nothing. A `vite build --watch` rebuild starts a new run at `buildStart`.
What Kit hashes for a CSP on a `csr = false` page is its inlined CSS, which holds no minted URL,
so removing the mark breaks no hash.

## 7. Warm

`import.meta.og.image('./hero.jpg', { warm: 'cover' })` (or a list) asks for the `cover` preset's
files at build, for pages rendered on a live server (a prerendered page's are built anyway). The
server build collects the warmed sources and the writer (§6) makes them. `<Img preset="cover">` of
that source, with nothing said over the preset, names those files (`mint(recipe, built: true)`):
on the server, and in an island, where nothing can sign. In dev the endpoint makes them. An unknown
name is `image_warm_unknown`.

## 8. In the browser

Nothing in the browser can sign. An island's `<Img>` keeps the server's `src` / `srcset` (Svelte
skips them while hydrating; `<Img>` reads them back once from the element, so an update after
hydration leaves them alone) and the server's head preload (found by `data-og-img="<id>"`, not
rendered again). A render that only ever happens in the browser shows warmed files, or the
original.

## 9. Markdown and frontmatter

With `content({ markdown })` and `image()` listed, a local `![alt](./x.jpg)` becomes `<Img>` (the
`prose` preset, or `markdown.width`), through content's markdown extension seam (a Vite plugin's
`api.ogygiaMarkdown`). `markdown.animated` names a declared preset (else `image_option_invalid`) that
a moving source takes instead: the rewrite writes `preset={x.animated ? '<animated>' : 'prose'}` (and
`markdown.width` only for a still one), so the choice is made from the descriptor at render, the
preset's width and `sizes` reach the srcset, and the build makes only that preset's files. A frontmatter value that starts `./` or `../` and names an image becomes a
descriptor; any other string stays a string. A raw HTML `<img src="./x">` is `image_markdown_html`.
`og.md(text)` has no file to resolve against (`image_markdown_no_file`).

## 10. Morph

`morph` names the image for a view transition by its source (`view-transition-name: og-img-<id>`),
so a thumbnail glides into the post's hero on a client-side navigation. Opt-in: two of one source
on a page would cancel the whole transition, which core's `rule_transition_name_unique` reports in
dev and in every e2e test.

## 11. Proof

Unit tests (`packages/image/test`), benches (`bench/image.bench.ts`: lay_out over a page, recipe
reads, the markdown rewrite, the macro, the option checks), and the e2e fixture
(`packages/image/e2e/app`) in four modes: adapter-node, adapter-static with no server, dev, and
adapter-static under `paths.base`.

---

# Part two: next

## 12. Remote sources

### 12.1 At build (built)

`image({ remote: { hosts, maxBytes = 20 MB, timeout = 10 s, maxAge = 1 day } })`, checked in
`vite/options.ts`. A `hosts` entry is a host (port when not the default), `*.` in front for every
name below it (one label or more, never the name itself, never over an address or a top-level
name), `http://` in front to allow plain HTTP; no path, no range (`src/remote-hosts.ts`,
`RemoteHosts.allows`: scheme, host and port must match; a URL with a user or password never does).

- The macro (`import.meta.og.image('https://…')`) checks the URL (`image_remote_host`, naming the
  entry to add; a `data:`, protocol-relative or other-scheme URL is refused the same way) and
  imports `virtual:ogygia-image/remote/<b64url URL>?og-image=…`. `.glob` stays local
  (`image_option_invalid`, key `pattern`). A remote source takes local `dark`/`art` twins (their
  paths written absolute into the query); a twin that is a URL is `image_option_invalid`.
- The plugin's `resolveId` fetches it (`vite/remote.ts`) into
  `node_modules/.ogygia/image/remote/<sha256(URL) hex, 32>.<ext>`, with `<name>.json` holding its
  URL, ext, `etag`, `last-modified`, and resolves to that file: from there it is a file source
  (`load`'s src/ check admits the remote folder). One flight per URL and folder per process (a
  `slot`, so Kit's server and client builds share one answer). A kept copy is asked again with
  `if-none-match`/`if-modified-since`; 304 keeps it. Redirects (`redirect: 'manual'`) at most 3,
  each hop checked (`image_remote_host` with `via`, never stale). Body counted as it streams,
  dropped past `maxBytes` (and a `content-length` over it); the whole fetch in one scope whose
  timer closes it at `timeout` (`scope.task` → `STALE` → "no answer within"). Only
  `image/{jpeg,png,webp,avif,gif,tiff}`. Any failure with a copy: the copy and
  `image_remote_stale`; without: `image_remote_failed` (reason). No retries.
- Markdown: a body `<img>` and a frontmatter string on a listed host become descriptors; others
  stay plain.
- The endpoint's originals: the server build's `renderChunk` writes the fetched names into the
  sources module (`export const remote = [...]`); `Originals.has` admits
  `<appDir>/immutable/assets/<name>.<hash>.<ext>` for a listed name. In dev the handoff carries the
  remote folder and `on-disk.ts is_remote` admits a file there by its hashed name.
- Tests: `test/remote.test.ts` (hosts, fast-check; the fetch against a local server: 200, 304,
  redirect chain, unlisted hop, loop, oversize streamed and by length, content type, 404, timeout,
  offline with and without a copy, one fetch per process), macro, markdown, plugin, server; e2e
  fixture host `e2e/app/remote-host.ts` on 127.0.0.1:4176 (`/remote`, `/blog/fourth-post`).

### 12.2 At request (built)

`remoteImage(url, { width, height, alt?, version? })` from `@ogygia/image` (`src/remote-image.ts`,
browser-safe): a descriptor `{ id: 'r' + 32 b64url chars of sha256(URL \0 version \0 encoder
version), src: <canonical href>, width, height, format (by extension, else jpeg), from: 'remote',
alt? }`. Sync, so it hashes with `src/sha256.ts` (pure JS, checked against node:crypto by
fast-check). No placeholder. Bad input: `image_remote_invalid` (render error). Hosts are not
checked here: where it is fetched.

- Recipe: `from: 'remote'` (never in a URL by itself); `recipe_tail` = `.remote/<b64url href>`, so
  the signed message covers the URL; `remote_of_tail` reads only an http(s) URL whose href is
  exactly what was encoded.
- Endpoint (`server.ts` `Originals.has`): a `.remote/` tail whose URL `remote.hosts` does not list
  (or no `remote` at all) is 404 `no-store`, warned once (`image_remote_refused`); a list changed
  since a URL was signed refuses it the same way. `settle.ts`: the original is fetched by
  `remote-fetch.ts` (shared with the build: hops host-checked, ≤3; streamed `maxBytes`; one
  `scope` timeout; `image/*` raster types; `content-encoding` other than identity refused; first
  bytes must be a JPEG/PNG/GIF/WebP/ISO-BMFF/TIFF signature), one flight per URL (`keep: 0`), run
  inside the encode queue, so fetches count against the same cap as encodes. Refusals, each
  `no-store` and `image_remote_refused`: 404 unlisted hop or private address, 413 too large, 504
  timeout, 502 status / no answer / not an image / did not decode.
- Never `immutable`: the store key is `<recipe file>@<maxAge>.<window>` (window = wall seconds /
  maxAge), and the answer is `public, max-age=<seconds left in the window>,
  stale-while-revalidate=<maxAge>`, so no copy (store, CDN, browser) outlives its window by more
  than `maxAge`. The binding maker keeps the same keys in `caches.default`.
- Transport (`virtual:ogygia-image/remote`, chosen at build): Node's (`remote-node.ts`,
  `node:http(s)`, no agent pooling, no decoding) for the sharp maker and dev; a Worker's
  (`net.fetch`, `redirect: 'manual'`) for the binding maker. With no `remote`: `remote-off.ts`.
- SSRF rule (`remote-hosts.ts`): a host an entry names itself (a name or an address) is trusted
  wherever it resolves (an intranet, a test server). A host taken only by a `*.` entry is connected
  to only when every address it resolves to is public (`private_address`: loopback, RFC 1918,
  CGNAT, link-local incl. cloud metadata, reserved, documentation, multicast; IPv6 ULA, link-local,
  site-local, multicast, and v4-mapped / NAT64 / 6to4 forms of the v4 ranges). Checked inside the
  connection's own `lookup`, on the addresses it connects to (no DNS-rebinding gap). The build's
  fetch uses the same transport, so the rule holds at build too. Workers: Cloudflare's network
  reaches no private address; no lookup hook exists there.
- Prerender: the minter notes the `.remote/` recipe like any other; the build's end fetches the URL
  through `RemoteImages` (same cache, revalidation, stale rule), names the file by the bytes'
  `source_id`, and rewrites every `immutable/og/<r id>-` in the prerendered output to the content
  id: a URL whose bytes change gets new names, never an old immutable file. No `remote`: the build
  fails `image_unsettled` (reason `image_remote_host`). The head start skips remote recipes.
- Links: `cloudflare()` names `/cdn-cgi/image/<opts>/<full URL>` (the zone's Transformations must
  allow that origin: "Sources: any origin" or the host listed); `vercel()` names
  `/_vercel/image?url=<escaped URL>`, and `image_vercel_config` requires `images.remotePatterns`
  reaching each `hosts` entry and no wider (probes: `ogygia-probe.invalid`, the listed host over the
  other scheme or any port, a name below an exact host); the line it prints carries them.
- Tests: `test/remote-request.test.ts` (endpoint: 200 + header window, shared fetch, kept within the
  window and fetched again after, forged tail/id 403, unlisted / changed list 404, 413, 504, 502,
  hop 404, private `*.` 404 vs named 200), `test/remote-image.test.ts` (descriptor, ids, invalid
  input, tail round trip, sha256 property, private ranges + v4-in-v6 property, lookup), build-write
  (prerender naming and rewrite, no `remote` fails), vercel (remotePatterns); e2e `/cms`
  (prerendered in static/adapter modes) and `/late/cms` (live only: listed with `version`,
  unlisted 127.0.0.1:4177, 30 MB, slow), in image, cloudflare, cloudflare-links and vercel specs.
  The fixture host runs for the whole e2e run (`e2e/remote-host-setup.ts`, a `globalSetup`).

## 13. Cards

BUILT (V4 R9). `import.meta.og.image.card('./Card.svelte', { width, height, fonts })` →
`(props) => ImageDescriptor`. A card is a source like any other: no route, no `entries()`, no
`site({ cards })`.

- **Macro** (`vite/macro.ts`, `vite/card.ts` `Cards.define`): literal args; a `.svelte` component;
  whole `width`/`height` to 99999; `fonts` at least one `.woff`/`.ttf`/`.otf` path (relative, or a
  package file through the importer's resolution), each read at build for family (name ID 16, else
  ID 1 with a trailing weight word dropped), `OS/2` weight and italic (`vite/font-face.ts`). Errors:
  `image_card_font`, `image_option_invalid`/`_unknown`, `image_not_found`. The call becomes an
  import of `virtual:ogygia-image/card/<card>`, `<card>` = 16 b64url chars of SHA-256 of
  (component path, size, font paths).
- **Card module**: server = the component imported as `<file>?og-card` (each `.svelte` it imports
  resolved under the same query; `with_injected_css` puts `css="injected"` in its options tag, so
  the render's head carries its scoped CSS and the page's own copy is untouched), Svelte's
  `render`, the fonts as assets, `card(spec)` (`src/card.ts`), and, off the edge, `png` from
  `cards/engine.ts`. Browser = `card_in_browser` (`image_no_server`).
- **Descriptor**: `{ id: 'c' + 32 b64url of SHA-256(digest, size, canonical props JSON, encoder
  version), src: <minted own-size PNG>, width, height, format: 'png', from: 'card', card:
  '<card>/<b64url props>' }`. Props: one plain JSON object (sorted keys), at most 2048 b64url
  chars (`image_card_props`). Recipes carry `from: 'card'` and the tail `.card/<card>/<props>`
  (`recipe.ts` `card_of_tail`), signed with the head; no namer names one (no CDN can fetch a
  card's original).
- **Digest**: the server build's `renderChunk` writes it over a placeholder: SHA-256 of the card
  def, the engine line (satori, satori-html, @resvg/resvg-js, svelte versions, encoder version),
  and every module the card's module reaches in the module graph, by project path and its file's
  bytes (packages and virtual modules by id). Dev: a fresh value at each load; every file change
  invalidates the card modules.
- **Endpoint** (`settle.ts`, `cards/read.ts`): `virtual:ogygia-image/cards` finds the card's
  module: a build's list of the cards' own emitted chunks (written at `renderChunk`), dev's
  import by name, the edge's none (`cards/none.ts`). The own-size PNG is drawn once per tail in
  the encode queue (satori-html → entities decoded in the tree → satori → resvg; satori's refusal
  = `image_card_css`), then the maker resizes/converts it; kept forever. A card whose digest
  changed since minting (`card_id` mismatch) or a name the server lacks = 404
  `image_source_changed`.
- **Build** (`build-files.ts`): a prerendered page's card recipe is noted like any other; the
  build's end imports the card's chunk from the server output, draws it with the fonts' files and
  makes each file with sharp into `<appDir>/immutable/og/`. No head start for cards.
- **Edge** (no engine: adapter-cloudflare and other edge adapters): the build warns
  `image_no_encoder` (`what: 'card'`); a live page's card URL is answered from the platform's
  `ASSETS` with the build's file of the same recipe when a prerendered page made it, else 404
  `no-store` + `image_no_encoder` once (`CARD_ENGINE_CHECK` decides missing/unlisted/edge).
- **Dev rule** `image_share_format` (`share-rule.ts`, the server realm's dev-only `handle`): an
  `og:image`/`twitter:image` naming an AVIF or WebP file.

## 14. Platform encoders and URL mappers

An encoder decides who makes the file and what URL names it:

- `sharp()` (today's, the default): signed recipes, the endpoint makes them.
- `cloudflare()`: URLs mapped to `/cdn-cgi/image/width=…,format=…,fit=cover,gravity=…/<original>`;
  Cloudflare's edge makes them, no sharp at runtime (the Workers case `image_no_encoder` names).
- `vercel()`: `/_vercel/image?url=<original>&w=…&q=…`, the widths from the app's breakpoints
  (Vercel requires the list in its config: the adapter writes it).

Each declares the operations it can honor; an op it cannot (a `tint` on Vercel) is a build error
naming the encoder and the op. Prerendered pages keep the signed files either way, so a static
host still needs no image service.

## 15. Dark and art-direction twins

BUILT (V4 R6). A twin is another candidate set chosen by a media condition:
`{ media, of?, aspect?, position?, width?, still?, theme? }` (`descriptor.ts` `Twin`). Three kinds,
one shape:

- **still**: a moving source's first frame, at `(prefers-reduced-motion: reduce)`, derived at
  render, never stored. Recipe head `-s`; sharp reads one page, Cloudflare `anim=false`, Vercel
  cannot (need `still`): with `vercel()` alone `RenderConfig.stills` is false, no still is offered
  anywhere, and the server build warns `image_still_left_out`.
- **art**: a preset's `art`, `<Img art>` / `getImage(of, { art })` (own replaces the preset's), or
  the macro's `art: { '<media>': './x.jpg' }` (on the descriptor). A crop of the source (`aspect`,
  `position`, `width` over the request) or another source (`of`), which keeps its own shape unless
  it says `aspect`.
- **dark**: the macro's `dark: './x-dark.png'`, the same shape (`image_option_invalid` otherwise).

`lay_out` lays out each twin with its own crop and box and writes `<source media>` rows (each with
its own `width`/`height`) before the format rows, in one fixed order: still; each art twin (the
request's, then the source's; a crop of a source with a dark file first as the dark file at
`<media> and (prefers-color-scheme: dark)`); dark; formats. `media` is a parenthesized condition
with no comma, so it joins with `and`. A priority image writes one preload per set, each at
`<its media> and (not <each earlier media>)`, the base at `(not …)` of all: exactly one matches
(property test, `test/twins.test.ts`).

`image({ theme: { dark, light } })`: `<source media>` cannot read an attribute, so a dark-twinned
image is laid out as two pictures (`Laid.dark`), `data-og-theme="light"|"dark"`, and a CSS asset
(`virtual:ogygia-image/theme.css`, imported by `<Img>`, empty without `theme`) shows one: dark when
the dark selector matches, or when the system prefers dark and the light selector does not. Both
lazy (a hidden lazy image is never fetched, e2e in three engines); a priority pair is eager with
preloads at `(not (prefers-color-scheme: dark))` / `(prefers-color-scheme: dark)`. `warm` warms
twins (the warmed source lists each twin's original by id).

## 16. Deferred raster

A region rendered per request to pixels (`render: 'deferred', format: 'image'`): the SSR writes an
`<img>` whose URL is the region's signed hole (the capability path: a `fetch`ed hole like any
other, `format: 'image'` in the signed message so an HTML capability is never an image one), with
the region's fallback rendered once at build as its placeholder. Live regions stay HTML/SVG.
