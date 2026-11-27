# Images — spec v4: "pages ask, the endpoint settles"

Part one is the core of `@ogygia/image` (v3). Part two is v4 on top of it: encoders (§14), source
kinds beyond a local file (remote §12, cards §13) and twins (§15), all built; §16 is the one part
still design. The user docs are `apps/docs/src/content/docs/10-content/07-images`; the package
README and both AI skills say the same in short.

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
(`ENCODER`): runtime (dev, client, prerendered, server, edge) × the endpoint's maker (sharp,
binding, none) × installed × listed. With no sharp maker (`cloudflare()`, `vercel()` alone) sharp
is needed to build only (`devDependencies` is enough). An edge build warns `image_no_encoder` once
only when `sharp()` is chosen, and fails when it lists no encoder (§5). On a server only the endpoint loads sharp (a lazy
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

`{ id, src, width, height, format, ph?, animated?, quality?, ops?, warm?, alt?, from?, card?,
twins? }`. Plain JSON: it crosses island props, refs, devalue, freeze and federation unchanged. No
list of files: render decides those. `warm` lists the presets the build made ahead for this source
(§7). `from` is absent for a file the build read, `'remote'` for a URL known only at request
(§12.2), `'card'` for a share card (§13, whose `card` holds `<card>/<b64url props>`). `twins` are
the macro's dark and art files, each `{ media, of, theme? }` with a full descriptor of its own (its
own placeholder), one level deep (§15).

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

A runtime that cannot load sharp answers a coded 500 (`image_no_encoder`, said once). A build for
an adapter whose runtime has no native modules (Cloudflare, Deno, edge: one `ADAPTERS` table in
`vite/encoder.ts`) fails `image_option_invalid` (key `encoder`) when it lists no encoder: on
Cloudflare's adapters it names `cloudflare()`, on any of them `encoder: sharp()` to say only
prerendered pages show images; with `sharp()` chosen it warns `image_no_encoder` once per adapter
(§1). The table reads the adapter's package name only: adapter-netlify's `edge: true` and
adapter-vercel's `runtime: 'edge'` are not seen (a known gap, in the docs). A failed encode is `image_settle_failed` and a 500 no cache keeps. Two lines (`settle.ts`
`Line`: a machine `queue()`, the 503 bound, `image_busy` said once per streak): encodes (the maker
says how many run at once: sharp half the cores, 1 to 4; the binding 4) and remote fetches (16). A
remote original is fetched before its encode takes a slot. Past either line at most 64 wait, each
at most 30 s, then 503 `image_busy` with `retry-after`. sharp's input pixel limit is on, and no
recipe asks for more pixels than one frame may have (`FRAME_PIXELS_MAX` in `recipe.ts`,
268,402,689: `parse_recipe` refuses a box past it, 404). AVIF is made at effort 2 by default
(`pixels.ts AVIF_EFFORT`; was 4: half the encode time for 0.2% more bytes, owner ruling on
DECISIONS 174), WebP at 4; `ENCODER_VERSION` 5. `sharp({ effort: { avif } })` sets it (a whole
number 0 to 9, else `image_option_invalid`; another key `image_option_unknown`): the build's files
(the handoff's `avif_effort`), the dev server's and the endpoint's (a generated maker module,
`makers/sharp-at.ts sharp_maker(effort)`). Files keep their names (the effort changes their size,
not their picture); each effort has its own store folder (`v5-avif<n>-<vips>`), so a warm build
never keeps bytes made at another effort.

The macro compiles a call in a JS module, a `.svelte` component's `<script>` and a markdown page's
(`.svx`, `.md`) `<script>`: ogygia hands every plugin macro the module's code regions
(`MacroContext.regions`). A call left anywhere else (a template expression, a markdown page's prose
`{…}`) fails the build with the compiler's `macro_in_markup`; a call written as text (a code span,
fenced code, prose, a `<code>` sample) is no call.

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
(disk, not memory: the prerender is a worker), tells the build's own thread on a `BroadcastChannel`
named by the run, which starts its file at once (`BuildMakes`: one flight per file over a queue of
up to 8, so the head start and the writer below make each file once), and names it
`<mark><built URL>`. The mark is `//<16 hex>.ogygia.invalid`, random per build and in
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

After the writer, the handoff says so (`written` = the client app folder, no notes, no mark, and
`renamed`: each URL id the build renamed to its bytes' id, a remote source's): a page rendered
later in the same process tree (an adapter's SPA fallback, which Kit 2.70 renders `ssr: false`
anyway) names the files as written (under `renamed` ids), or the original where no prerendered
page asked for that file, and notes nothing. A `vite build --watch` rebuild starts a new run at `buildStart`.
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
rendered again). A render that only ever happens in the browser shows warmed files, an encoder's
links (they need no key, §14), or the original.

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
reads, the markdown rewrite, the macro, the option checks), a counted build gate
(`test/build-counts.test.ts`: the fixture's cold static build makes N files with N encodes, a warm
one 0), a timed build bench (`bench/build-time.ts`, reported, not gated), and the e2e fixture
(`packages/image/e2e/app`) in nine modes: `node` (vite preview), `server` (adapter-node's own
output), `static` (adapter-static, no server), `dev`, `base` (`paths.base`), `cloudflare`
(adapter-cloudflare under `wrangler dev`, the Images binding), `cloudflare-links`
(`/cdn-cgi/image` link shapes), `vercel` (`[vercel(), sharp()]`, the function run by
`e2e/serve-vercel.ts` with the output's routes read) and `vercel-alone`. The first five run in
Chromium, Firefox and WebKit; the adapter modes are request-level and run in Chromium.

---

# Part two: v4 (built), and next

## 12. Remote sources

### 12.1 At build (built)

`image({ remote: { hosts, maxBytes = 20 MB, timeout = 10 s, maxAge = 1 day } })`, checked in
`vite/options.ts`. A `hosts` entry is a host (port when not the default), `*.` in front for every
name below it (one label or more, never the name itself, never over an address or a top-level
name), `http://` in front to allow plain HTTP; no path, no range (`src/remote-hosts.ts`,
`RemoteHosts.allows`: scheme, host and port must match; a URL with a user or password never does).
A `*.` entry over a public suffix anyone can host under is refused (`SHARED_SUFFIXES`: country
second levels, hosting platforms, and families such as `s3.*.amazonaws.com` where `*` is a region's
label), or over a name above one (`*.googleapis.com` is above `storage.googleapis.com`,
`*.us-east-1.amazonaws.com` above `s3.us-east-1.amazonaws.com`: `over_shared` reads the entry's
labels against each suffix's last ones; a name below one is one tenant's, never refused), and a
name (entry or URL) is read without DNS's trailing dot. An entry that names a host
itself takes every path on it: a shared storage host that serves every tenant under one name lets
every tenant through (the docs say so; a path scope on an entry would be new surface).

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
  bytes must be a JPEG/PNG/GIF/WebP/ISO-BMFF/TIFF signature), one flight per URL (`keep: 0`), in
  the fetch line (16, §5) before the encode takes its slot. Refusals, each `no-store`: 404 unlisted
  hop or private address, 413 too large, 504 timeout, 502 status / no answer / not an image / did
  not decode. "Did not decode" is one rule for every maker and the card fitter: `maker.ts
  unreadable(e)` says whether a decoder's failure is a broken file (a libvips loader error, cut
  pixels included, past one frame's pixels, or an Images binding error about its input: 9412,
  9413, 9520, 9523), and only then is it `SourceUnreadable`, the URL's 502; any other failure
  (memory under load, the platform) is that one ask's 500 `image_settle_failed`, remembered
  nowhere. A refused URL is remembered for 30 s (a machine `cache`, at most 1024 URLs): every
  file of it is answered the same status with no fetch meanwhile, so a replayed URL costs one
  fetch per 30 s. `image_remote_refused` is said once per failing streak per URL (`said_each`,
  its own memory beside the constant keys' `said`), and said again after a good fetch.
- A remote source is never made larger than it is: sharp's box is scaled down within the real
  size, aspect kept (`pixels.ts within`); Cloudflare's links and binding use `fit=crop`, which
  only shrinks. `remoteImage()` refuses a box past `FRAME_PIXELS_MAX` (`image_remote_invalid`).
  The srcset is still planned from the stated size (the docs say so).
- Never `immutable`: the store key is `<recipe file>@<maxAge>.<window>`, window = (wall seconds +
  `bucket32(URL) % maxAge`) / maxAge (a per-URL offset, so a server's remote files do not all
  expire at one instant), and the answer is `public, max-age=<seconds left in the window>,
  stale-while-revalidate=<maxAge>`, so no copy (store, CDN, browser) outlives its window by more
  than `maxAge`. `maxAge` is 1 or more. The binding maker keeps the same keys in `caches.default`.
  A file kept in memory (no store) keeps its window's end (`ends_at`, wall time), not a header:
  each ask's `max-age` is what is left of that window, and the memory lets it go at that end.
- Stale on error: a 5xx `Refused` (host error, no answer, timeout, bytes that do not decode) for a
  windowed key opens `<key>@<maxAge>.<window - 1>` (same span, same per-key offset); when the
  store holds it, it is answered `public, max-age=30` (the failure memory's span), still said once
  as `image_remote_refused`. A 404 or 413 is the host's answer about the URL, not an outage: no
  stale copy. One window later there is no `window - 1` file and the refusal is answered.
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
  other scheme or any port, a name below an exact host); the line it prints carries them. A link
  is named only for a URL `remote.hosts` lists (`linkable`, checked at mint in the server realm):
  an unlisted one gets the endpoint's signed URL, which refuses it 404 as with `sharp()`. In the
  browser (no hosts list) a remote recipe gets no link at all, only its original URL.
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
  every module the card's module reaches in the module graph, by project path and its file's bytes
  (packages too; virtual modules by id and code), and the CSS each component compiles to (its
  `$$css` code: what Tailwind or PostCSS made of its styles). The rest of a file's built code is
  left out: a cold and a warm build make it differently (test/build-counts.test.ts holds the warm
  build to the cold one's names). Dev: a fresh value at each load; every file change invalidates
  the card modules.
- **Images** (`cards/images.ts`): satori fetches nothing. Before it draws, every address the tree
  names (each `src`, an SVG element's `href` / `xlink:href`, each `url()` in a style or attribute;
  `#…` refs are the card's own) is read by the card's realm, fitted to the card (`cards/fit.ts`,
  the realm's sharp: the build's, or the maker's `fit` at the endpoint, so a server whose maker is
  not sharp bundles no sharp and refuses a card's image, `image_card_source`; refused
  from its header past `FRAME_PIXELS_MAX`, made smaller to the least size that covers the card and
  at most 4 cards of pixels, re-encoded as 8-bit sRGB PNG with alpha or JPEG; a file resvg does
  not draw as it is is re-encoded at any size: `resvg_draws(bytes)` = an 8-bit PNG, an 8-bit grey
  or RGB baseline/progressive JPEG (no CMYK, 12-bit, arithmetic or lossless), a GIF, read from the
  bytes; the fitter also wants sharp's `space` sRGB or `b-w`, `depth` uchar, no ICC profile (resvg
  reads none: a Display P3 file draws off-colour) and no EXIF turn. resvg draws a WebP, AVIF or CMYK
  JPEG as nothing, with no error) and handed over as bytes: an
  `<img src>` as an `ArrayBuffer` (satori keeps a module-level LRU of 500 `data:` texts; bytes it
  does not keep), any other as a `data:` URL of the type its bytes are. A link's `href` outside an
  SVG names no image and is left out of the tree. Then `drawable()` checks the tree satori is
  handed, whole: every `src` / `href` / `xlink:href` is bytes or a `data:` URL whose bytes sniff
  as a `RESVG_DRAWS` type, or `#`, and every `url(` (closed or not, any case) is followed by
  such a `data:` URL or `#`, or the card is
  `image_card_source`. Attribute values are entity-decoded first
  (`engine.ts decoded`, with the text), so `&amp;` queries and `&quot;` quoted `url()`s reach the
  guard as meant. Endpoint realm: an asset with Kit's `read()`, a URL through settle's
  `remote_bytes` (hosts, `*.` rule, maxBytes, timeout, the fetch line, the failure memory). Build
  realm: a file of Kit's server output only (what the endpoint's `read()` serves, so a prerender
  and a live draw agree: no `static/` file, no client-only asset), a URL through
  `RemoteImages.file`. A `data:` URL is read like any address: its bytes must be PNG/JPEG/GIF/WebP/AVIF (SVG
  refused: it names addresses itself). Anything else is `image_card_source` (`{ file, src,
  reason }`). A realm's own answer (a full line, a remote refusal: `RealmAnswer`) passes through
  the draw, so the card's file gets that status (503, 502/504/413), not a 500. `<Img>` inside a
  card is not supported (its signed URLs are refused, coded).
- **Endpoint** (`settle.ts`, `cards/read.ts`): `virtual:ogygia-image/cards` finds the card's
  module: a build's list of the cards' own emitted chunks (written at `renderChunk`), dev's
  import by name, the edge's none (`cards/none.ts`). The own-size PNG is drawn once per tail in
  the encode queue (satori-html → entities decoded in the tree → satori → resvg; satori's refusal
  = `image_card_css`), then the maker resizes/converts it; kept forever, unless the draw read a
  remote URL (the per-draw reader notes it): then it is a remote file, kept under the key's
  `remote.maxAge` window and sent with that window's header, never `immutable`. A remote image
  the fitter finds a broken file (`SourceUnreadable`, the same `unreadable(e)` rule as a
  `remoteImage()` file) is that URL's failure (the reader's `unfit` hook: 502, remembered 30 s,
  said once); any other fit failure (memory) is that card's 500 `image_card_source`, remembered
  nowhere; a server with no fitter reads no image at all. A card whose digest
  changed since minting (`card_id` mismatch) or a name the server lacks = 404
  `image_source_changed`.
- **Build** (`build-files.ts`): a prerendered page's card recipe is noted like any other; the
  build's end imports the card's chunk from the server output, draws it with the fonts' files and
  makes each file with sharp into `<appDir>/immutable/og/`. No head start for cards. A card whose
  draw read remote URLs (fetched through `write_built`'s remote fetch) is named
  `card_shown_id(id, url → source id)` and every prerendered name of it rewritten, as a
  `remoteImage()` file is; the URLs it read are kept as `<key>.shown` in the store, so a warm
  build refetches them (revalidated), finds the named file and draws nothing.
- **Edge** (no engine: adapter-cloudflare and other edge adapters): the build warns
  `image_no_encoder` (`what: 'card'`); a live page's card URL is answered from the platform's
  `ASSETS` with the build's file of the same recipe when a prerendered page made it, else 404
  `no-store` + `image_no_encoder` once (`CARD_ENGINE_CHECK` decides missing/unlisted/edge).
- **Dev rule** `image_share_format` (`share-rule.ts`, the server realm's dev-only `handle`): an
  `og:image`/`twitter:image` naming an AVIF or WebP file.

## 14. Encoders

BUILT (V4 R2–R5). An encoder is plain data from a factory in `@ogygia/image/vite`
(`vite/encoder.ts` `Encoder`: `name`, `links` = the needs its links can make or null, `maker` =
`'sharp' | 'binding' | null`, `binding`, `negotiates`, `widths`, `qualities`). `image({ encoder })`
takes one or a list. It picks two modules at build:

- `virtual:ogygia-image/maker` (server only): re-exports one of `makers/sharp.ts`,
  `makers/binding.ts`, `makers/none.ts`; dev always gets sharp. A Worker bundle holds no sharp.
- `virtual:ogygia-image/namer` (isomorphic): `namers/endpoint.ts` (`name = () => null`, sign) for
  `sharp()`, else `namers/resolve.ts` with the plan and only the listed platforms' link code
  (`CLOUDFLARE_LINKS`, `VERCEL_LINKS`). Links need no key, so an island names them in the browser.

Resolution per recipe, at render: a built or warmed file first (§6, §7: always made by the build,
with sharp, whatever the encoder); else the first linking encoder whose links cover the recipe's
needs and limits (a width past every size, a quality not listed) → its link; else the endpoint, when
the first encoder with a maker can make it → a signed URL; else `image_encoder_cannot` (render
error, `{ encoder, need }`). Dev runs the same check (every file made by sharp), so a page fails in
dev where it would fail deployed. A list is in order of priority, and every list where the walk
could differ from that order is refused (`image_option_invalid`): two platforms, two makers, or
anything after `sharp()`. Valid: one encoder, or `[vercel(), sharp()]`.

**Capabilities** are one `decisions()` table over (encoder × need) (`encoders/capabilities.ts`,
needs in `encoders/needs.ts`: box, crop, each position, rotate quarter/other, each op and modulate
field, each output format, `png from another format`, source gif/tiff/avif, animated, still),
snapshotted, verified against each platform's docs (DECISIONS 96, 104, 116):

| encoder                | cannot                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `sharp`                | nothing                                                                                                                           |
| `cloudflare` (binding) | `entropy`, rotate other than 90/180/270, normalize, negate, tint, modulate hue/lightness, gamma, an AVIF source (Enterprise only) |
| `cloudflare links`     | the binding's list, plus PNG from another format (a link's `format=` has no `png`)                                                |
| `vercel`               | crop, any position, any op, named PNG/JPEG, a GIF/TIFF/animated source, a still                                                   |

- **`sharp()`** (default): the app's endpoint signs and makes every live file.
- **`cloudflare({ links = true, binding = 'IMAGES' })`** (adapter-cloudflare and
  adapter-cloudflare-workers only, else `image_option_invalid` at the server build's
  configResolved; adapter-auto too): links are
  `/cdn-cgi/image/width=,height=,fit=cover,gravity=,quality=,format=[,anim=false][,ops]/<original>`
  in one fixed option order (a full URL and `fit=crop` for a remote source, which never enlarges
  it); `format=` named (Cloudflare does not negotiate), so the `<source type>` rows stay. `links: false`: the Worker's endpoint makes each
  file with `env[binding]` in sharp's step order (flip → rotate → box → tone; a remote source's box
  `fit: 'crop'`), kept in `caches.default` under
  `https://ogygia-image.invalid/v<STEPS_VERSION>/<file>` (STEPS_VERSION 2), `immutable`. No
  binding: 500 `no-store`, `image_binding_missing` once. An edge build that lists no encoder fails
  (§5).
- **`vercel({ sizes?, qualities? })`** (adapter-vercel only): links `/_vercel/image?url=<escaped
  original>&w=<size>&q=<q>`; every ladder width of the app is snapped up to a size or the
  source's own width (`RenderConfig.widths`, so one ladder for links, sharp crops and built files);
  q per format (AVIF 60, WebP 80) keeps two `<source>` rows; Vercel picks the format from `Accept`.
  Defaults: sizes = 16…384 ∪ the default breakpoints; qualities `[60, 80]` (a plugin/preset
  `quality` outside them is `image_option_invalid`). `vercel()` returns `images` for the adapter
  (`{ sizes, qualities, formats: [avif, webp], domains: [], localPatterns: [^/_app/immutable/assets/.+$] }`,
  `remotePatterns` added by the app for `remote.hosts`). A plugin with `closeBundle: { order: 'post',
  sequential: true }` (after Kit's adapt) reads `.vercel/output/config.json` and fails
  `image_vercel_config` (printing the exact value) when `images` lacks a width, quality, format or
  host the build names, or opens more: no `qualities`, `localPatterns` unset or wider, a
  `remotePatterns` entry reaching a host `hosts` does not list. A config.json older than the build
  also fails. `vercel()` alone: maker none, no sharp in the function, no still anywhere
  (`image_still_left_out`).

Platform links are unsigned: anyone can ask for other sizes, each billed; the docs say so and point
to `links: false` / `sharp()` for a signed door.

**Cache headers.** ogygia writes no header file. Every built file sits under
`<appDir>/immutable/og/`, which each adapter already sends `immutable` (node: sirv; cloudflare:
Kit's `_headers` rule; vercel: a route; netlify: Kit's rule); adapter-static leaves it to the host
(docs give the line). e2e pins each adapter's header on a built file, an original and an endpoint
answer, and `no-store` on every refusal. Known adapter gap (not ogygia's): adapter-cloudflare's
404 for a missing `_app/immutable/*` path carries the `immutable` rule too.

**Live cards on Vercel.** harfbuzzjs (satori's text shaper) reads `hb.wasm` from its own folder by a
path built at run time, which adapter-vercel's file tracing (@vercel/nft) cannot follow. So a
server card's chunk exports `engine_files`, a `new URL(<relative path>, import.meta.url)` to the
real `hb.wasm` (`engine_files()` in `vite/card.ts` resolves it from the app through satori), written
over a placeholder when the chunk is rendered; nft follows that form and keeps the file. Nothing
reads it at run time. The tracer must follow the server output where the build wrote it (as
adapter-vercel does); one that traces a copy at another depth would miss it. With `[vercel(),
sharp()]` a card's images are fitted by the sharp maker, whose native binary and libvips the trace
keeps (sharp is imported statically). With `vercel()` alone the maker is none: it encodes nothing,
but hands back a PNG asked for as it is (own size, no position, op or still), which is a live card's
file, so a card is drawn there; one that names an image is refused `image_card_source` ("list
sharp()"), since none fits images. vercel-alone.spec pins both.

**Known gaps.** adapter-vercel's
deprecated `runtime: 'edge'` cannot build an ogygia server (core's server chunks import Node's
`crypto`/`fs`). A Worker bundle still carries `on-disk.js` and core's Node chunks (never run;
`nodejs_compat` needed). No deployed smoke has run yet: Cloudflare/Vercel pixels, `Vary: Accept`,
CDN headers on links and the `caches.default` key host are checked only by shape locally.

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
