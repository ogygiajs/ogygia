/**
 * EVERY MESSAGE THE IMAGE PLUGIN PRINTS, in one place: its code, its wording, what to do about it.
 *
 *   throw new OgygiaError('image_not_found', { file, src });
 *
 * The plugin and the image endpoint run in Node, never in a page, so the wording always prints, then
 * the code's page. What `<Img>` itself says lives in ./render-messages.ts (it can run in a page).
 *
 * @packageDocumentation
 */
import { say, type Say } from '@ogygia/machine';
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** `<Img>`'s own errors, for the docs' message pages. */
export { IMAGE_RENDER_ERRORS } from './render-messages.ts';

/** The errors: `throw new OgygiaError(code, args)`. */
export const IMAGE_ERRORS = {
	image_outside_src: {
		text: (a: { file: string; src: string }): string => prose`
			${a.file}: an image must sit under ${a.src}/, outside src/lib/server/ and test files, for the
			image endpoint to read it.
		`,
		details: (): string => prose`
			Files are made from an image when a page asks for them, by the server, which reads the
			original with Kit's \`read()\`. Kit can only read an asset its server bundle carries; the
			image plugin makes every image under \`src/\` one of them, except \`src/lib/server/\` (never
			published) and test files (\`*.test.*\`, \`*.spec.*\`, \`__tests__/\`). Move the file under
			\`src/\` (a \`$lib\` folder, or beside the page or document that shows it).
		`
	},
	image_sharp_missing: {
		text: (a: { adapter: string | null; installed: boolean }): string =>
			a.installed
				? prose`
					${a.adapter ?? 'This server build'} makes image files on request with sharp, but the
					app's package.json does not list sharp in its \`dependencies\`: add it there
					(\`pnpm add sharp\`).
				`
				: prose`
					image() needs sharp, the image encoder, installed in the app: add sharp to your
					dependencies (\`pnpm add sharp\`).
				`,
		details: (): string => prose`
			sharp is a peer of @ogygia/image: the app installs it, so the app picks its version and
			its native binary is installed for the app's platform. The build and the dev server
			measure every image with it, so it must be installed and listed in the app's own
			package.json. Any server build also needs it in \`dependencies\` (not
			\`devDependencies\`): a server adapter may bundle every package its app does not list
			there (adapter-node does), and sharp bundled cannot find its native binary, so every image
			the server makes on request would answer 500 (\`image_no_encoder\`). A fully prerendered
			app (adapter-static) needs sharp installed and listed, and \`devDependencies\` is enough.
		`
	},
	image_no_kit: {
		text: (): string => prose`
			image() found no SvelteKit config in this Vite build: list \`sveltekit()\` in vite.config's
			plugins, after \`image()\`.
		`,
		details: (): string => prose`
			The image plugin serves files under the app's base path and asset folder, which it reads
			from SvelteKit's own Vite plugin. Without SvelteKit there is no server to make the files
			and no paths to name them by.
		`
	},
	image_warm_unknown: {
		text: (a: { where: string; preset: string; known: string }): string => prose`
			${a.where}: warm names the preset '${a.preset}', which image({ presets }) does not declare.
			Declared: ${a.known}.
		`,
		details: (): string => prose`
			\`import.meta.og.image('./hero.jpg', { warm: 'cover' })\` makes the files of the \`cover\`
			preset at build, so a server-rendered page finds them ready. The name must be one of the
			presets in vite.config: a misspelled one would warm nothing, and the first visitor would
			wait for every file.
		`
	},
	image_unsettled: {
		text: (a: { url: string; source: string; reason: string }): string =>
			`the build could not make the image ${a.url} from ${a.source} (${a.reason}).`,
		details: (): string => prose`
			Every image file a prerendered page names (in its markup, or through \`getImage()\` in a CSS
			background), and every file of a warmed preset, is made by the build and written under the
			app folder (\`_app/immutable/og/\`), so any host serves it as a file. This one failed: its
			original could not be read from the build output, or the encoder (sharp) could not decode
			it. The build stops rather than ship a page with a missing image.
		`
	},
	image_mark_left: {
		text: (a: { file: string; form: string }): string => prose`
			${a.file}: a prerendered file names an image URL the build cannot point at its file: the
			page ${a.form} before writing it.
		`,
		details: (): string => prose`
			While a page prerenders, each image URL it is given starts with the build's mark
			(\`//<random>.ogygia.invalid\`), a host Kit's crawler does not follow, because the file is
			not made yet. When the prerender ends, the build makes every file and removes the mark from
			every prerendered file, so each URL names its file under \`_app/immutable/og/\`. A URL made
			absolute (\`new URL(laid.src, page.url)\` for an \`og:image\` or a feed) becomes the file at
			Kit's prerender origin, which is what \`page.url\` names while a page prerenders: set
			\`kit.prerender.origin\` to the site's origin (\`https://example.com\`), or the build cannot
			know it. This URL was changed another way (escaped, or encoded into a query string), so the
			build cannot find it. Write the URL as \`<Img>\` or \`getImage()\` gave it, or as an absolute
			URL; encode it in the browser, not in the page.
		`
	},
	image_macro_arity: {
		text: (a: { file: string; line: number }): string =>
			`${a.file}:${a.line} — import.meta.og.image(src, options?) takes a path and, at most, an options object.`,
		details: (): string => prose`
			\`import.meta.og.image\` reads one image file at build time:
			\`import.meta.og.image('./hero.jpg')\`, or with options,
			\`import.meta.og.image('./hero.jpg', { quality: 70 })\`.
		`
	},
	image_macro_not_literal: {
		text: (a: { file: string; line: number; what: string }): string => prose`
			${a.file}:${a.line} — import.meta.og.image(): ${a.what} must be written out in place (a string
			literal path, an object literal of plain values).
		`,
		details: (): string => prose`
			The build reads the call before any code runs, so the path and options must be literals:
			no variables, no template strings with \`\${…}\`, no function calls. To pick an image at run
			time, make every candidate at build (\`import.meta.og.image.glob('./gallery/*.jpg')\`) and
			choose among the results.
		`
	},
	image_query_invalid: {
		text: (a: { query: string }): string =>
			`the og-image query '?${a.query}' does not hold the options import.meta.og.image() writes.`,
		details: (): string => prose`
			The \`og-image\` query is written by the image macro, its options encoded inside. Import
			images through \`import.meta.og.image('./x.jpg', { … })\` instead of writing the query by
			hand.
		`
	},
	image_remote_host: {
		text: (a: { where: string; url: string; entry: string; via?: string }): string =>
			a.entry === ''
				? prose`
					${a.where}: '${a.url}' is no image URL the build can fetch: a remote image is an
					https:// URL (or http:// from a host listed with it) on a host image({ remote: { hosts } })
					lists.
				`
				: prose`
					${a.where}: ${a.via === undefined ? `'${a.url}'` : `'${a.via}' redirects to '${a.url}', which`}
					is on a host image({ remote: { hosts } }) does not list. Add '${a.entry}' to
					\`hosts\` if the app should take images from it.
				`,
		details: (): string => prose`
			The build fetches a remote image (\`import.meta.og.image('https://…')\`, a markdown image or a
			frontmatter URL) only from the hosts the app lists in vite.config:
			\`image({ remote: { hosts: ['images.example.com', '*.cdn.example.com'] } })\`. A name with
			\`*.\` in front lists every name below it; plain \`http://\` is taken only from an entry
			that says \`http://\`. Each redirect is checked the same way, so a listed host cannot hand
			the build a file from one that is not. A markdown or frontmatter URL on a host that is not
			listed stays a plain \`<img>\` or string.
		`
	},
	image_remote_failed: {
		text: (a: { where: string; url: string; reason: string }): string =>
			`${a.where}: the build could not fetch the image ${a.url} (${a.reason}), and has no copy of it.`,
		details: (): string => prose`
			A remote image is fetched once into the build cache (\`node_modules/.ogygia/image/remote/\`)
			and asked again on every build with its \`etag\` or \`last-modified\`, so an unchanged image is
			not downloaded again. This one could not be fetched and was never fetched before: the host
			answered an error status, took longer than \`remote.timeout\` (default 10 s), sent more
			than \`remote.maxBytes\` (default 20 MB), followed more than 3 redirects, or sent something
			that is not a PNG, JPEG, WebP, AVIF, GIF or TIFF image. Check the URL in a browser, or
			raise the limit in \`image({ remote })\`.
		`
	},
	image_card_engine_missing: {
		text: (a: { missing: string; dependencies?: boolean }): string =>
			a.dependencies
				? prose`
					This server build draws share cards on request with ${a.missing}, but the app's
					package.json does not list them all in its \`dependencies\`: add them there
					(\`pnpm add satori satori-html @resvg/resvg-js\`).
				`
				: prose`
					A share card (\`import.meta.og.image.card()\`) is drawn with satori, satori-html and
					resvg, and the app has not installed ${a.missing}: \`pnpm add satori satori-html
					@resvg/resvg-js\`.
				`,
		details: (): string => prose`
			A card is drawn from its component by three packages the app installs itself, so an app
			with no card loads none of them: satori-html reads the component's HTML and CSS, satori lays
			it out and draws it as SVG, and resvg (\`@resvg/resvg-js\`, a native module) turns that into a
			PNG. The build draws every card a prerendered page names. A server that draws cards on
			request needs them in \`dependencies\` (not \`devDependencies\`): a server adapter may bundle
			every package its app does not list there (adapter-node does), and resvg bundled cannot
			find its native binary.
		`
	},
	image_card_font: {
		text: (a: { where: string; font: string; why: string }): string =>
			`${a.where}: the card's font ${a.font} cannot be used: ${a.why}.`,
		details: (): string => prose`
			satori draws a card's text with the fonts the card lists and no other (it reads no system
			font): \`fonts: ['./serif.woff', '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff']\`,
			each a path relative to the file, or a package's file. Each must be a TrueType, OpenType or
			WOFF file (\`.ttf\`, \`.otf\`, \`.woff\`): satori reads no WOFF2. The build reads each file's
			family, weight and style from the file itself; the card's CSS names the family
			(\`font-family: 'Geist Serif'\`) and the weight.
		`
	},
	image_card_css: {
		text: (a: { file: string; property: string | null; reason: string }): string =>
			a.property === null
				? `${a.file}: satori cannot draw this card (${a.reason}).`
				: `${a.file}: satori cannot draw this card's CSS property '${a.property}' (${a.reason}).`,
		details: (): string => prose`
			A share card is drawn by satori, which lays out a subset of CSS: flexbox (every element
			with more than one child says \`display: flex\`), sizes, margins and padding, borders and
			radii, colors and gradients, fonts, text, transforms, opacity, and absolute positioning.
			It has no grid, no floats, no \`calc()\` in every property, no CSS variables in every
			place, and no \`z-index\`. The message names what it refused: change it to something in that
			subset. The images docs list what works.
		`
	},
	image_card_source: {
		text: (a: { file: string; src: string; reason: string }): string =>
			`${a.file}: this card names the image ${a.src}, which it cannot draw (${a.reason}).`,
		details: (): string => prose`
			A card never lets its drawing engine fetch an image itself: that would fetch any address
			its markup names, private ones included, with no size or time limit. Each image a card
			names (an \`<img src>\`, a style's \`url()\`) is read by ogygia and handed over as bytes.
			It may be an image of the build (the \`src\` of an \`import.meta.og.image()\` descriptor, a
			root-relative asset URL), an \`http(s)\` URL on a host \`image({ remote: { hosts } })\`
			lists (fetched under its size and time limits, like \`remoteImage()\`), or a \`data:\` URL.
			Its bytes must be PNG, JPEG, GIF, WebP or AVIF. A relative path, another scheme, or a URL
			with no \`remote\` set is refused.
		`
	},
	image_card_props: {
		text: (a: { file: string; at: string; why: string }): string =>
			`${a.file}: a card's props must be JSON, and small: ${a.at}: ${a.why}.`,
		details: (): string => prose`
			A card's files carry its props in their URLs, signed with the rest, so the server that
			makes a file on request needs nothing but the URL, and nobody can ask it for props the
			page did not name. So the props are one plain object of what JSON holds (strings, finite
			numbers, booleans, null, arrays and plain objects; no \`undefined\`, Date, Map or function),
			at most 2048 characters once written in the URL: a title and a few fields. Pass the text
			the card shows, not the record it came from.
		`
	},
	image_not_found: {
		text: (a: { file: string; src: string }): string =>
			`${a.file}: the image '${a.src}' does not exist (paths are relative to this file).`,
		details: (): string => prose`
			An image path resolves against the file that names it, like an import. Check the spelling and
			the folder, and that the file is committed.
		`
	},
	image_markdown_no_file: {
		text: (a: { src: string }): string => prose`
			markdown with no file of its own (\`import.meta.og.md(text)\`) names the local image
			'${a.src}', which has nothing to resolve against.
		`,
		details: (): string => prose`
			A local image in markdown resolves against the markdown file, like an import. Markdown
			rendered from a string has no file, so there is nowhere to look. Use a site-absolute or
			remote URL there (\`/images/x.png\`), or move the markdown into a \`.md\` file beside the
			image.
		`
	},
	image_path_malformed: {
		text: (a: { file: string; src: string }): string =>
			`${a.file}: the image path '${a.src}' could not be decoded (a %-escape that is not UTF-8).`,
		details: (): string => prose`
			Markdown writes an image path as a URL, so a space is \`%20\` and an accent is its UTF-8
			bytes, like \`%C3%A9\`. This path has an escape that does not decode to text. Write the file
			name as it is (\`![](<./my photo.jpg>)\`), or escape it as UTF-8.
		`
	},
	image_markdown_html: {
		text: (a: { file: string; src: string }): string => prose`
			${a.file}: <img src="${a.src}"> in markdown HTML names a local file, which would ship as a
			broken link. Write it as ![alt](${a.src}).
		`,
		details: (): string => prose`
			A markdown image (\`![alt](./x.jpg)\`) is encoded at build and rendered through \`<Img>\`. An
			HTML \`<img>\` is copied as text, so its relative path points at nothing once the page is
			served. Use the markdown form, or put the file in \`static/\` and name it from the site root.
		`
	},
	image_glob_empty: {
		text: (a: { file: string; pattern: string }): string =>
			`${a.file}: import.meta.og.image.glob('${a.pattern}') matched no file.`,
		details: (): string => prose`
			An empty gallery is almost always a wrong pattern, so the build stops instead of rendering
			nothing. Patterns resolve against the file that names them.
		`
	},
	image_option_unknown: {
		text: (a: { where: string; key: string; known: string }): string =>
			`${a.where}: unknown image option '${a.key}'. Known: ${a.known}.`,
		details: (): string => prose`
			A misspelled option would otherwise be ignored and the image encoded the default way.
		`
	},
	image_option_invalid: {
		text: (a: { where: string; key: string; rule: string }): string =>
			`${a.where}: image option '${a.key}' must be ${a.rule}.`,
		details: (): string => prose`
			The option has a value the encoder cannot use. The message names the rule it breaks.
		`
	},
	image_too_large: {
		text: (a: { file: string; reason: string }): string =>
			`${a.file}: the image is too large to encode (${a.reason}).`,
		details: (): string => prose`
			The encoder (sharp) reads at most 268,402,689 pixels a frame (16383 × 16383), and an
			animation at most 4,294,967,296 pixels over all its frames: a long screen recording of
			1200 × 800 with 300 frames is 288 million, well inside. A file past either would take
			minutes to encode on every server that makes it, so the build stops here. Make the image
			smaller, or cut the animation shorter or to fewer frames per second (a GIF made at 10
			frames per second is a third of one at 30), or show it as a video.
		`
	},
	image_decode_failed: {
		text: (a: { file: string; reason: string }): string =>
			`${a.file}: the image could not be read (${a.reason}).`,
		details: (): string => prose`
			The encoder (sharp) could not decode the file: it may be damaged, empty, or in a format it
			does not read (AVIF, WebP, PNG, JPEG, GIF, TIFF and SVG are read).
		`
	},
	image_vercel_config: {
		text: (a: { missing: string; have: string; line: string }): string => prose`
			vercel() names files Vercel's image optimizer would refuse: the adapter's output config
			lacks ${a.missing} (it has ${a.have}). Hand the encoder's images to the adapter:
			${a.line}.
		`,
		details: (): string => prose`
			With \`vercel()\`, a page rendered on request names each file as a
			\`/_vercel/image?url=…&w=…&q=…\` link, and Vercel answers it only when the deployment's
			\`images\` config (\`.vercel/output/config.json\`, written by adapter-vercel) allows that
			width (\`sizes\`), that quality (\`qualities\`, when it lists any), the format the browser
			gets (\`formats\`), and, for a full-URL \`paths.assets\`, its host (\`domains\` or
			\`remotePatterns\`). Pass the encoder's own: keep it in one file
			(\`export const encoder = vercel({ sizes })\`), import it in svelte.config.js and in
			vite.config, and write \`adapter({ images: encoder.images })\`, adding the assets host to
			\`domains\` if there is one. \`vercel()\` needs adapter-vercel: \`/_vercel/image\` exists
			only on Vercel.
		`
	}
};

/** The warnings: `warn(code, args)`. */
export const IMAGE_WARNINGS = {
	image_settle_failed: {
		text: (a: { path: string; reason: string }): string =>
			`the image endpoint could not make ${a.path} (${a.reason}); it answered 500.`,
		details: (): string => prose`
			A page asked for a file its signed URL describes, and making it failed: the original could
			not be read (Kit's \`read()\`), or the encoder (sharp) could not decode or write it. The page
			keeps its placeholder.
		`
	},
	image_source_changed: {
		text: (a: { path: string; tail: string }): string =>
			`the image endpoint was asked for ${a.path}, but its original ${a.tail} is not that source any more; it answered 404.`,
		details: (): string => prose`
			Every image file is named by its source's content (the id at the start of its name). A
			page named this file, and the original was edited (or replaced) after that page was
			rendered, so making the file now would put the new pixels under the old name, where a
			browser or CDN keeps them for good. Reload the page: it names the new source's files. On a
			live server, a descriptor whose id and \`src\` name two different files (one built by hand,
			or from a CMS) gets this too: make descriptors with \`import.meta.og.image()\`.
		`
	},
	image_no_encoder: {
		text: (a: { reason: string; what?: 'file' | 'card' }): string =>
			a.what === 'card'
				? `this server cannot draw share cards: ${a.reason}.`
				: `this server cannot make image files: the encoder (sharp) did not load (${a.reason}); image requests answer 500.`,
		details: (): string => prose`
			With \`sharp()\`, the default encoder, image files are made by sharp, a native Node module.
			A runtime without it (an edge or Workers runtime, an install that skipped sharp's binary)
			cannot make them. On Cloudflare Workers, list the encoder that can:
			\`image({ encoder: cloudflare() })\` from \`@ogygia/image/vite\`. Otherwise prerender the
			pages that show images (their files are made at build), warm the presets server-rendered
			pages use (\`import.meta.og.image(src, { warm: 'cover' })\`), or deploy to a Node server.
			A share card (\`import.meta.og.image.card()\`) is drawn by satori and resvg, which run in
			Node only: on an edge runtime, a page rendered on request serves a card's files only when
			the build made them, because a prerendered page names the same card with the same props.
			Prerender the pages that show cards, or deploy to a Node server.
		`
	},
	image_binding_missing: {
		text: (a: { binding: string }): string =>
			`the image endpoint makes files with the Cloudflare Images binding ${a.binding}, but this Worker has no such binding; image requests answer 500.`,
		details: (): string => prose`
			\`cloudflare()\` makes each file a page rendered on request asks for with the Worker's Images
			binding, read from \`event.platform.env\`. Add it to the Worker's wrangler config
			(\`"images": { "binding": "IMAGES" }\`), or name the one it has:
			\`cloudflare({ binding: 'MY_IMAGES' })\`. Outside a Worker (a Node server) there is no
			binding: use \`sharp()\` there.
		`
	},
	image_store_write_failed: {
		text: (a: { dir: string; reason: string }): string =>
			`the image file store ${a.dir} could not keep a file (${a.reason}): files are answered, and kept in memory instead.`,
		details: (): string => prose`
			The image endpoint keeps each file it made on disk, so the next ask, and the next start,
			reads it instead of making it again. Writing there failed: a full disk, a folder that is
			read-only, or a quota. The file was still answered. Until the store can write again, the
			server keeps the files it made in a small memory cache (the least recently asked go first)
			and makes the others again on the next ask. Free space in the temporary folder, or make it
			writable.
		`
	},
	image_busy: {
		text: (a: { waiting: number }): string =>
			`the image endpoint has ${a.waiting} files waiting to be made: it answers 503 (retry-after) until the line is shorter.`,
		details: (): string => prose`
			A live server makes a few files at once and queues a bounded number more, so a burst of
			asks for new files (a page of many images on a cold server, or a client asking for many
			URLs) cannot hold unbounded memory and CPU. Past that line, an ask is answered 503 with a
			\`retry-after\`, which no cache keeps; the browser shows the placeholder, and the next visit
			gets the file. Warm the presets your server-rendered pages use
			(\`import.meta.og.image(src, { warm: 'cover' })\`), or put a CDN in front, which asks once
			per file.
		`
	},
	image_still_left_out: {
		text: (a: { encoders: string }): string => prose`
			${a.encoders} cannot make the first frame of a moving image, so no moving image offers a
			still to visitors who ask for less motion.
		`,
		details: (): string => prose`
			A moving image (an animated GIF or WebP) gets a still twin: its first frame, shown at
			\`(prefers-reduced-motion: reduce)\`, which is what WCAG 2.2.2 asks for. A file a page
			rendered on request names is made by the app's encoder, and Vercel's optimizer serves a
			moving source as it is, with no way to keep one frame. List \`sharp()\` after it
			(\`encoder: [vercel(), sharp()]\`) so the app's endpoint makes stills, or prerender the
			pages that show moving images.
		`
	},
	image_remote_stale: {
		text: (a: { where: string; url: string; reason: string }): string =>
			`${a.where}: the build could not ask for the image ${a.url} again (${a.reason}): it uses the copy it fetched before, which may be out of date.`,
		details: (): string => prose`
			Every build asks the host whether a remote image changed (one request with the copy's
			\`etag\` or \`last-modified\`). The host could not be reached, or did not answer with an
			image, so the build uses the copy in its cache (\`node_modules/.ogygia/image/remote/\`): an
			offline build still works. If the image changed on the host, this build shows the old
			one. Build again once the host answers.
		`
	},
	image_remote_refused: {
		text: (a: { url: string; status: number; reason: string }): string =>
			`the image endpoint answered ${a.status} for a file of the remote image ${a.url}: ${a.reason}.`,
		details: (): string => prose`
			A \`remoteImage(url, { width, height })\` is made by the image endpoint from the URL's bytes,
			fetched when a file is first asked for, under \`image({ remote: { hosts, maxBytes, timeout } })\`.
			It answers 404 when the URL's host is not in \`hosts\` (the URL was signed, but the list
			changed since, or \`remote\` is not set), when a redirect leads to a host that is not, or
			when a host listed only by a \`*.\` entry resolves to a private address (list that host
			itself to allow it); 413 when the image is past \`maxBytes\`; 504 when it took longer than
			\`timeout\`; 502 when the host answered an error status, could not be reached, or sent
			something that is not a JPEG, PNG, WebP, AVIF, GIF or TIFF image. None of these answers is
			kept by a browser or a CDN, so the next ask tries again.
		`
	},
	image_store_unsafe: {
		text: (a: { dir: string }): string =>
			`the image file store ${a.dir} is not a folder only this user owns: files are made on every ask, and not kept.`,
		details: (): string => prose`
			A live server keeps the files it made under the system's temporary folder, in a folder only
			its user can read and write. Another user's folder, or a link, at that place could hand out
			files it chose, under URLs browsers keep forever, so the server keeps nothing there. Remove
			the folder, or run the server as the user that owns it.
		`
	},
	image_share_format: {
		text: (a: { path: string; url: string }): string =>
			`${a.path}: the share image ${a.url} is ${a.url.endsWith('.avif') ? 'AVIF' : 'WebP'}, which most link previews do not show.`,
		details: (): string => prose`
			An \`og:image\` (or \`twitter:image\`) is read by the crawlers of chat apps and social sites,
			and most of them read PNG and JPEG only. Name a PNG or JPEG file there: a share card's own
			\`src\` is a PNG, and a preset for share images says its format
			(\`share: { width: 1200, height: 630, formats: ['png'] }\`). Said in dev only.
		`
	}
};

type Own = MessagesOf<typeof IMAGE_ERRORS, typeof IMAGE_WARNINGS>;
const own: Own = define_messages(IMAGE_ERRORS, IMAGE_WARNINGS);
/** `throw new OgygiaError(code, args)`. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
/** `warn(code, args)`. */
export const warn: Own['warn'] = own.warn;

/** The warnings of a condition that lasts (a full line of encodes, a store that cannot write): each
 *  is said once per streak, `said.once(key, …)` when it starts and `said.ok(key)` when it ends. */
export const said: Say = say();
