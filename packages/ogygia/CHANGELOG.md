---
title: Releases
summary: Each release of ogygia, newest first.
---

All notable changes to **ogygia** are documented in this file, newest first. Each entry is a PR's
changeset, written by the release: do not edit by hand.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.14.0

### Minor Changes

- [#508](https://github.com/ogygiajs/ogygia/pull/508) [`eae1add`](https://github.com/ogygiajs/ogygia/commit/eae1add17f6b2767ef375761b0019873158eaf7f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Breaking: the barrel rewrite is a plugin now, `barrels()` from `@ogygia/barrels`, listed beside `ogygia()` (`plugins: [ogygia(), barrels(), sveltekit()]`) with the same options. Use it in place of `ogygia({ barrels })`, which is a build error (`barrels_option_removed`) that names it; `debarrel()`, `DebarrelOptions` and `DebarrelMatcher` are gone from `ogygia/vite`.

- [#532](https://github.com/ogygiajs/ogygia/pull/532) [`b011a71`](https://github.com/ogygiajs/ogygia/commit/b011a71bce244dc521383e1e019080928e94a271) Thanks [@PuruVJ](https://github.com/PuruVJ)! - - `@ogygia/core`, `ogygia`: breaking (internal paths only): `ogygia/internal/region-core` is gone, and `ogygia/internal/compiler` no longer exports `set_parser` or takes a `pathModule` option; they existed only to run the compiler in a browser. Import `region` and `isRegion` from `ogygia`. Build output is unchanged.

- [#1665](https://github.com/ogygiajs/ogygia/pull/1665) [`096de6c`](https://github.com/ogygiajs/ogygia/commit/096de6c511675e5555f3843860a042a28135246d) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Breaking: shipping only the `page.data` your islands read is a plugin now, `dataShake()` from `@ogygia/data-shake/vite`, listed beside `ogygia()` (`plugins: [ogygia(), dataShake(), sveltekit()]`). Without it every island that reads the page gets all of `page.data`, and every server hole looks the page up.

- [#610](https://github.com/ogygiajs/ogygia/pull/610) [`e07f6e4`](https://github.com/ogygiajs/ogygia/commit/e07f6e47d569ff00853fa6145a57205b2099fb21) Thanks [@PuruVJ](https://github.com/PuruVJ)! - breaking: `ogygia` depends only on `@ogygia/core` and `@ogygia/compiler`, and no `ogygia/*` path forwards to a plugin package. `ogygia/insights` is removed: install `@ogygia/insights` and import from it (same names).

- [#693](https://github.com/ogygiajs/ogygia/pull/693) [`b0a4f0e`](https://github.com/ogygiajs/ogygia/commit/b0a4f0ec367fb7742c8a3d30da6d18e1db201dbc) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `region(C, props, { version })` in `@ogygia/core`: when two answers for the same held region reach the browser (two commands that both return it), the one with the newer data version stays on screen, whichever arrived last.

- [#528](https://github.com/ogygiajs/ogygia/pull/528) [`9201d45`](https://github.com/ogygiajs/ogygia/commit/9201d457b41f0fce8a5e3fccf744ff5a1e7da50f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - - `@ogygia/core`, `ogygia`: breaking: the internal `internal/compiler-browser` and `internal/compiler-browser-full` import paths are gone. The compiler runs in Node only; use `@ogygia/core/internal/compiler` there.
  - `@ogygia/cli`: breaking: the `ogygia mcp` server no longer has the `ogygia_observatory` tool; the Observatory it linked to is gone.
  - `@ogygia/content`: its macros and markdown pipeline read the compiler through `@ogygia/core/internal/compiler` and Node's own `fs`, `path` and `crypto`.

- [#1707](https://github.com/ogygiajs/ogygia/pull/1707) [`b20ae04`](https://github.com/ogygiajs/ogygia/commit/b20ae049ea45cf56581becb1f7a7e95bbaa6f029) Thanks [@PuruVJ](https://github.com/PuruVJ)! - - breaking: an app's own pass over the HTML ogygia sends is the new `@ogygia/rewrite` package. `ogygia.handle({ transform })` now throws `handle_transform_moved`; list `rewrite()` (from `@ogygia/rewrite/vite`, no options) beside `ogygia()`, and put a `rewrite()` handle before `ogygia.handle()` in `sequence()`. `ogygia/markup` is removed, and `scanRegions` / `liftRegions` / `restoreRegions` leave `ogygia/server`.
  - `@ogygia/rewrite`: `rewrite({ match, render })` renders only the outermost custom elements `match` picks (a tag prefix, a list of tags, or a test), in one `render(elements, ctx)` call per chunk of the page and per region answer, so a streamed page keeps streaming and its later chunks are rendered too.
  - `@ogygia/rewrite`: each element `render` gets has ogygia's marks numbered from 0, so a cache can key on its bytes; equal elements in one call are rendered once.
  - `@ogygia/rewrite`: `ctx` carries `kind`, `csr`, `url`, `event` and `signal`, an AbortSignal that fires when the request is cancelled.
  - `@ogygia/rewrite`: a render's `sheets` go out once per key per response, into the head while it is open and inline before the first element that needs them after.
  - `@ogygia/rewrite`: a failed batch is retried one element at a time; an element that still fails, drops ogygia's marks, or returns HTML that does not close what it opens goes out as ogygia rendered it, with a warning in every build (`rewrite_element_failed`, `rewrite_marks_lost`), never thrown.
  - `@ogygia/rewrite`: an element split across streamed chunks goes out unrendered, said in dev (`rewrite_element_split`).
  - `@ogygia/rewrite`: several rewrites in `sequence()` run in order on one marking of the HTML; one listed after `ogygia.handle()` throws `rewrite_after_ogygia`, and a rewrite without the plugin throws `rewrite_plugin_missing`.
  - `@ogygia/rewrite`: `rewrite({ page })` rewrites the whole document (held until its last chunk) or region answer, says `rewrite_page_failed` when it throws (thrown in dev), and has `.html(str)` for a plain string.
  - `@ogygia/rewrite`: `.check(html, { kind, csr })` runs the whole round trip on one piece of markup for a test, listing failures and, with a DOM, every restored element that differs from Svelte's.
  - `@ogygia/rewrite`: a page where nothing was restored ships no restorer, and each streamed chunk that restored something ends with one short restore call.
  - `@ogygia/devtools`: the profiler reads a page's regions itself and no longer depends on `@ogygia/rewrite`.

- [#516](https://github.com/ogygiajs/ogygia/pull/516) [`368b1da`](https://github.com/ogygiajs/ogygia/commit/368b1da8008b4dd1e44790fc8146a230f2d2da07) Thanks [@PuruVJ](https://github.com/PuruVJ)! - - `@ogygia/core`, `ogygia`: breaking: `SharedState` is no longer exported from `ogygia` or `@ogygia/core`. Import it from `@ogygia/federation/shared` instead; it works the same.
  - `@ogygia/federation`: `SharedState` (state shared across separate builds on one page) is exported from `@ogygia/federation/shared`.

### Patch Changes

- [#533](https://github.com/ogygiajs/ogygia/pull/533) [`49ff074`](https://github.com/ogygiajs/ogygia/commit/49ff074bc20128e9b7aadc5c98922dcecd136617) Thanks [@PuruVJ](https://github.com/PuruVJ)! - - `@ogygia/compiler`: new package, ogygia's compiler and its Vite plugin: `@ogygia/compiler` (the compiler), `@ogygia/compiler/vite` (`ogygia()`, `definePlugin`) and `@ogygia/compiler/ids`. It uses core only through `@ogygia/core/contract`; core never depends on it.
  - `@ogygia/core`: breaking: the `@ogygia/core/vite`, `@ogygia/core/internal/compiler` and `@ogygia/core/internal/compiler-ids` import paths are gone. Import from `ogygia/vite` (or `@ogygia/compiler/vite`), `@ogygia/compiler` and `@ogygia/compiler/ids` instead; the names are the same.
  - `@ogygia/core`: the types of the `ogygia:*` virtual modules and the build's switches are named in core (`@ogygia/core/contract`), so core's own types no longer reach into the compiler.
  - `ogygia`: `ogygia/vite`, `ogygia/internal/compiler` and `ogygia/internal/compiler-ids` re-export `@ogygia/compiler`; apps change nothing.
  - `@ogygia/barrels`, `@ogygia/cli`, `@ogygia/content`, `@ogygia/devtools`, `@ogygia/federation`, `@ogygia/flags`, `@ogygia/postrender`, `@ogygia/router`: they take `definePlugin` and the compiler from `@ogygia/compiler`, a new peer dependency (`ogygia` brings it).

- [#576](https://github.com/ogygiajs/ogygia/pull/576) [`7be0138`](https://github.com/ogygiajs/ogygia/commit/7be01386d3b4a2c8ab50dc651bab9046847b6401) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The head's duplicate-link pass reads each `<link>` attribute as HTML does, so a stylesheet or preload hint whose URL has an apostrophe is no longer dropped, and `data-rel` / `data-href` no longer count as `rel` / `href`.

- [#878](https://github.com/ogygiajs/ogygia/pull/878) [`08fd293`](https://github.com/ogygiajs/ogygia/commit/08fd2937c323bdbbaac6ca0f3dac694dfff9d786) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A hole answer's region URLs, island graph and region CSS are read as a browser reads the tags: a region or sheet inside an HTML comment is left alone, and upper-case tags, single-quoted values and a quoted `>` no longer hide one.

- [#577](https://github.com/ogygiajs/ogygia/pull/577) [`13aa062`](https://github.com/ogygiajs/ogygia/commit/13aa062ec40f5d76e37671e30230dc5f0cb0ab61) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A `$page.data` promise nested more than 65 levels deep, or inside a cyclic value, now streams into regions like any other: before, it was left in the seed, the page failed to serialize it, and a rejection went unhandled.

- [#577](https://github.com/ogygiajs/ogygia/pull/577) [`13aa062`](https://github.com/ogygiajs/ogygia/commit/13aa062ec40f5d76e37671e30230dc5f0cb0ab61) Thanks [@PuruVJ](https://github.com/PuruVJ)! - On a router (non-navigate) request, `$page.data` with promises keeps its key order in the seed; before, keys came in the order their values settled.
- Updated dependencies [[`558b9a9`](https://github.com/ogygiajs/ogygia/commit/558b9a9ed5e190e8ac67272e8e1c154f1c628442), [`9fb9b44`](https://github.com/ogygiajs/ogygia/commit/9fb9b4426c68652eecd37acafda05870b31063b0), [`d16b921`](https://github.com/ogygiajs/ogygia/commit/d16b9214227ad04ff2228354893637c6cc483b52), [`d61549f`](https://github.com/ogygiajs/ogygia/commit/d61549faa686efd6156bfbf7a9bb5358f13673a8), [`c61a561`](https://github.com/ogygiajs/ogygia/commit/c61a5613280295484b2d866d443491385c1e1568), [`55e05d4`](https://github.com/ogygiajs/ogygia/commit/55e05d48c2f6f811c8d6ee1fbd8656d06d64c5d3), [`6e90f0c`](https://github.com/ogygiajs/ogygia/commit/6e90f0c6f7b10cc667627d2bf4aef6366d6483fd), [`936654e`](https://github.com/ogygiajs/ogygia/commit/936654e2ecf00eb19a830ffb99f5d358395ed053), [`e1f6a87`](https://github.com/ogygiajs/ogygia/commit/e1f6a877ae8e7bb1110575100ad42aa94a977cce), [`eae1add`](https://github.com/ogygiajs/ogygia/commit/eae1add17f6b2767ef375761b0019873158eaf7f), [`8644a71`](https://github.com/ogygiajs/ogygia/commit/8644a71edbe3e61de3529d3317148b2401ff13c3), [`0b97707`](https://github.com/ogygiajs/ogygia/commit/0b977071dce937b75f8b5d530f173e2e7673dd2b), [`3faef3d`](https://github.com/ogygiajs/ogygia/commit/3faef3d051892e7ff54ae3017480799ba4861ae0), [`79f67f7`](https://github.com/ogygiajs/ogygia/commit/79f67f7cd3e575b4765662f796bec2621df2a3d4), [`b9af6be`](https://github.com/ogygiajs/ogygia/commit/b9af6be49a51b56a4afbfb4691689089ec61b6cf), [`bf92b58`](https://github.com/ogygiajs/ogygia/commit/bf92b58a3cd4106604fc1412cf76b2bc1d4cae39), [`032d21f`](https://github.com/ogygiajs/ogygia/commit/032d21f266dc35a84d1c8febd26afa1adfe016ae), [`95ed95c`](https://github.com/ogygiajs/ogygia/commit/95ed95c9b5fcd3a9c32348ff7e80e782140ce6ab), [`36de4b8`](https://github.com/ogygiajs/ogygia/commit/36de4b80cc38e037a4ae060ec7c04a86bfee2024), [`9caa92e`](https://github.com/ogygiajs/ogygia/commit/9caa92e4d1d3c68058a6e49c99ef6428c0a50db7), [`b3f4d94`](https://github.com/ogygiajs/ogygia/commit/b3f4d9470fc0984fc066a5516068e408b34f4b00), [`13b7427`](https://github.com/ogygiajs/ogygia/commit/13b7427be47497aa55d43f1a54ebb97771659653), [`6c215fd`](https://github.com/ogygiajs/ogygia/commit/6c215fd5ea2efa958315b9cd5d9d5c31a6afd045), [`25db3c9`](https://github.com/ogygiajs/ogygia/commit/25db3c916335e1fc7d47035bf3a45a1ebbb78db5), [`f7ffd0e`](https://github.com/ogygiajs/ogygia/commit/f7ffd0e83c2f32ce15d8aef69834946dbbca534c), [`938f79f`](https://github.com/ogygiajs/ogygia/commit/938f79fc9c1b8010e64e3c9e1183838888c4c43e), [`574999e`](https://github.com/ogygiajs/ogygia/commit/574999eff8d5b40bef2b018d9710780269c10f63), [`d460c55`](https://github.com/ogygiajs/ogygia/commit/d460c5509819e671b11aad23bad91988991f35c5), [`9459fff`](https://github.com/ogygiajs/ogygia/commit/9459fff9c01bd73ac81a0b30065a581752c5ed79), [`891228b`](https://github.com/ogygiajs/ogygia/commit/891228be09a447431064280a2c44c6e3927e17ca), [`b011a71`](https://github.com/ogygiajs/ogygia/commit/b011a71bce244dc521383e1e019080928e94a271), [`49ff074`](https://github.com/ogygiajs/ogygia/commit/49ff074bc20128e9b7aadc5c98922dcecd136617), [`6cfab1a`](https://github.com/ogygiajs/ogygia/commit/6cfab1a3c29a2bcccd888a916ab666642ce98c36), [`cc1b757`](https://github.com/ogygiajs/ogygia/commit/cc1b7579eff4d684496f7d39607f640b3ffc0afa), [`cf4be5b`](https://github.com/ogygiajs/ogygia/commit/cf4be5bee4dfa30326d72350479aa924634ebb5a), [`925cf79`](https://github.com/ogygiajs/ogygia/commit/925cf79fbbbd3a3b0391b77843c537e2633487c6), [`1a475de`](https://github.com/ogygiajs/ogygia/commit/1a475ded9ab584daecf49b180438ce4f4df02d8b), [`1a475de`](https://github.com/ogygiajs/ogygia/commit/1a475ded9ab584daecf49b180438ce4f4df02d8b), [`e891f09`](https://github.com/ogygiajs/ogygia/commit/e891f09ecd9bd7048ee1ae1b3394ed25a32ae701), [`2fdd64b`](https://github.com/ogygiajs/ogygia/commit/2fdd64b9a16e478c5332e0b7dd81574547e37a99), [`22e276e`](https://github.com/ogygiajs/ogygia/commit/22e276e626a3dc744c76f4f61fbc7aa6bc57990b), [`1a475de`](https://github.com/ogygiajs/ogygia/commit/1a475ded9ab584daecf49b180438ce4f4df02d8b), [`25c95f5`](https://github.com/ogygiajs/ogygia/commit/25c95f55f565ac375f07c3ce83fd952af3a81299), [`2fea150`](https://github.com/ogygiajs/ogygia/commit/2fea1504b09861d153e96850060a07e75a6a1189), [`096de6c`](https://github.com/ogygiajs/ogygia/commit/096de6c511675e5555f3843860a042a28135246d), [`a3ca2ad`](https://github.com/ogygiajs/ogygia/commit/a3ca2adb9cd494d9642f633259de8f1d3059e591), [`80f4d91`](https://github.com/ogygiajs/ogygia/commit/80f4d91430828e05a08b968d2bb1d762dcafa013), [`a4de38a`](https://github.com/ogygiajs/ogygia/commit/a4de38a1b1287c5f7d0edd4363ce28cd766bdd95), [`c688e01`](https://github.com/ogygiajs/ogygia/commit/c688e018abb56ebd2a6ffca50c6bbd7707063e5a), [`a4de38a`](https://github.com/ogygiajs/ogygia/commit/a4de38a1b1287c5f7d0edd4363ce28cd766bdd95), [`a4de38a`](https://github.com/ogygiajs/ogygia/commit/a4de38a1b1287c5f7d0edd4363ce28cd766bdd95), [`6fcf4e2`](https://github.com/ogygiajs/ogygia/commit/6fcf4e2e085c76d417c0a35a8acde7247a527e93), [`a4de38a`](https://github.com/ogygiajs/ogygia/commit/a4de38a1b1287c5f7d0edd4363ce28cd766bdd95), [`a4de38a`](https://github.com/ogygiajs/ogygia/commit/a4de38a1b1287c5f7d0edd4363ce28cd766bdd95), [`3ddf36b`](https://github.com/ogygiajs/ogygia/commit/3ddf36b075f9778c4ca4eed6033cb4d0558ccc1a), [`c22268b`](https://github.com/ogygiajs/ogygia/commit/c22268be07d7f0721beb81db35388ea6927f8e6a), [`724b0f3`](https://github.com/ogygiajs/ogygia/commit/724b0f34bc33489b3c0e1e451fc8ca32cb210f46), [`5373f25`](https://github.com/ogygiajs/ogygia/commit/5373f25a356539d016682527e79e106484ad58f4), [`e42f8d0`](https://github.com/ogygiajs/ogygia/commit/e42f8d01776fde734a7bd2dcb09b4c36c15818ad), [`d3f9cc7`](https://github.com/ogygiajs/ogygia/commit/d3f9cc76f8d0e15f2d51202225b39e6777e02d08), [`65733b6`](https://github.com/ogygiajs/ogygia/commit/65733b67cfe9dfe306720a61f3ccdfbadaa0f9b7), [`8fa29ec`](https://github.com/ogygiajs/ogygia/commit/8fa29ec466f3aa53c37f4a36988c919ff8357287), [`0a40057`](https://github.com/ogygiajs/ogygia/commit/0a400570963a8bd5092afb4ad3458dce5878432a), [`a46af31`](https://github.com/ogygiajs/ogygia/commit/a46af313cb0fb9fc2406db3f1017b4cc9672a4ab), [`abc4a42`](https://github.com/ogygiajs/ogygia/commit/abc4a427ca64b94b43f5e6d12d46236bddef5605), [`1bc6577`](https://github.com/ogygiajs/ogygia/commit/1bc6577d9b00374245a06e1f05d4821a1e738b14), [`c7ed8cf`](https://github.com/ogygiajs/ogygia/commit/c7ed8cf9a60aba97dca1b348197057b2db5baf2c), [`1f2bdb7`](https://github.com/ogygiajs/ogygia/commit/1f2bdb7b7060e58587195267e78cc905d717e816), [`e0b4429`](https://github.com/ogygiajs/ogygia/commit/e0b4429e40b98e38872d5bc8eb9cb02de5724f3c), [`586d8d6`](https://github.com/ogygiajs/ogygia/commit/586d8d684973579d44582015dfb4bb2b0205795e), [`79e5bfa`](https://github.com/ogygiajs/ogygia/commit/79e5bfa11a1005acda70f73f4f5a742694d602b0), [`f9ebb02`](https://github.com/ogygiajs/ogygia/commit/f9ebb024cf1ca688435e9dcc4106931cf43efe9a), [`0a4a20e`](https://github.com/ogygiajs/ogygia/commit/0a4a20ef14dc1df31f2f4511a09bd970fca893b9), [`c9e4346`](https://github.com/ogygiajs/ogygia/commit/c9e4346be4549773f525e188845ac870f07a3bc0), [`daa8d5c`](https://github.com/ogygiajs/ogygia/commit/daa8d5c8cee26d1493a451c697e413dd96c82c34), [`40b91ab`](https://github.com/ogygiajs/ogygia/commit/40b91ab2ba808b29b6586972a214ee5869d743bb), [`fe5c2c8`](https://github.com/ogygiajs/ogygia/commit/fe5c2c85fb622d2edff58fd16ea2a9aa59fbe2c0), [`5c5b673`](https://github.com/ogygiajs/ogygia/commit/5c5b673bf1d376def92c39ae3588d2e3db7c682d), [`6ebfbd9`](https://github.com/ogygiajs/ogygia/commit/6ebfbd9c7ea739b4dcb4e6c3fd48c1ac5f68b6a0), [`fc49f63`](https://github.com/ogygiajs/ogygia/commit/fc49f63a7fd3cd3eb048a0c7c4ac851b7dc61c00), [`13e08a2`](https://github.com/ogygiajs/ogygia/commit/13e08a2f643f451e3225ff3595293c4e6b841347), [`620d27e`](https://github.com/ogygiajs/ogygia/commit/620d27e2a6c55af9bce1791596c1db70db6321f9), [`6f03b81`](https://github.com/ogygiajs/ogygia/commit/6f03b813f8d64004d918a64d03713544f5e4253f), [`7be0138`](https://github.com/ogygiajs/ogygia/commit/7be01386d3b4a2c8ab50dc651bab9046847b6401), [`f018ab4`](https://github.com/ogygiajs/ogygia/commit/f018ab4c52cbbf5f85accacfb8da882d9b734812), [`715744f`](https://github.com/ogygiajs/ogygia/commit/715744f75a799f6928cfeaad082c5f84831ebfb1), [`b54c1bd`](https://github.com/ogygiajs/ogygia/commit/b54c1bdf2963bb01e24ab6c697ff7bc72a786365), [`c52057f`](https://github.com/ogygiajs/ogygia/commit/c52057fb2ff7c6c8c70f994560ab23784cf2751a), [`07c4c5d`](https://github.com/ogygiajs/ogygia/commit/07c4c5dd89ba2a977a9cda1a09c0a3e9949e5be9), [`97bec00`](https://github.com/ogygiajs/ogygia/commit/97bec00f7677463a67e04094c4e1e61f0309f2f1), [`527fb37`](https://github.com/ogygiajs/ogygia/commit/527fb376ed209d30ec264a576d9b0e57e8a039f9), [`c4a1b4a`](https://github.com/ogygiajs/ogygia/commit/c4a1b4af012b9de49fbf2e6c3c48518c462160ca), [`4a038b4`](https://github.com/ogygiajs/ogygia/commit/4a038b448068093e5333c21f31db4511c9cda23f), [`d5a120a`](https://github.com/ogygiajs/ogygia/commit/d5a120aec9634a976628e564a26b11ce98fc3969), [`7e9f615`](https://github.com/ogygiajs/ogygia/commit/7e9f61576b0a5595f61dc4bf104ff9be9159b773), [`f7e0684`](https://github.com/ogygiajs/ogygia/commit/f7e06841d30572eb620d3b302e310b29a674f5ff), [`4c732c6`](https://github.com/ogygiajs/ogygia/commit/4c732c62b9f52ee0eee62b66021fa00df3b0918c), [`55177a4`](https://github.com/ogygiajs/ogygia/commit/55177a4dcad68fa3b5740738fe8c9b30feb8914d), [`f8a4fbf`](https://github.com/ogygiajs/ogygia/commit/f8a4fbfa5ab3d3cd0f250d579a99ca930da50c26), [`8ef4954`](https://github.com/ogygiajs/ogygia/commit/8ef4954c07d02de7fd42d9e1134745d8b9c97f6c), [`a365b26`](https://github.com/ogygiajs/ogygia/commit/a365b26445fa66c337123611559a37f7a52edb8f), [`226364d`](https://github.com/ogygiajs/ogygia/commit/226364ded4e39dd77341df523240f04c3b1a78e7), [`78c6d48`](https://github.com/ogygiajs/ogygia/commit/78c6d486d863758ee16f01c25dd804da66354e18), [`37a9eaf`](https://github.com/ogygiajs/ogygia/commit/37a9eaf39877c88681dbd651eeac30d4719b1c8b), [`a4f938a`](https://github.com/ogygiajs/ogygia/commit/a4f938aaffcc84a84c167bbade1de60ca93a3189), [`db021f1`](https://github.com/ogygiajs/ogygia/commit/db021f1c51948228b2f0f22f7ba2d999a04a9ee3), [`2378a3c`](https://github.com/ogygiajs/ogygia/commit/2378a3cf092ae7f9d30db416b060841e83e47386), [`b823bff`](https://github.com/ogygiajs/ogygia/commit/b823bff47a5b5cecb6e595893f42897754141e55), [`4c64ac7`](https://github.com/ogygiajs/ogygia/commit/4c64ac72de7259124e59339ef7fd6a8644f7e83c), [`17834e0`](https://github.com/ogygiajs/ogygia/commit/17834e01bf2359c57b3ffbead88b5af2793e8f23), [`7929876`](https://github.com/ogygiajs/ogygia/commit/7929876b0ec1432546a1f2329f01e318984b7702), [`3fde46a`](https://github.com/ogygiajs/ogygia/commit/3fde46adb46565ca8ec837d9eb33f1f54c41e1a5), [`115137c`](https://github.com/ogygiajs/ogygia/commit/115137cc1a7ae4170c0ccce199bbe71a074936a3), [`9f87204`](https://github.com/ogygiajs/ogygia/commit/9f87204d45b7dab9be314237d73807fe8de54c9c), [`59495f6`](https://github.com/ogygiajs/ogygia/commit/59495f620fbab94c17a1278eb3a3c70d0c41929e), [`99e9496`](https://github.com/ogygiajs/ogygia/commit/99e94962c3f7bb94a6bdd1b3e009b479eae1991c), [`99e9496`](https://github.com/ogygiajs/ogygia/commit/99e94962c3f7bb94a6bdd1b3e009b479eae1991c), [`e39d03c`](https://github.com/ogygiajs/ogygia/commit/e39d03ca7a11b971ea4bf90a1aec300a12780443), [`74a5864`](https://github.com/ogygiajs/ogygia/commit/74a5864e2cd4daf321458fc2326f06062c982d81), [`bf5db5d`](https://github.com/ogygiajs/ogygia/commit/bf5db5dd5c19f7d84ff9bc032c693cd82dfc54f8), [`a878cae`](https://github.com/ogygiajs/ogygia/commit/a878cae9c9263fc38f342371ee150dcae95240ab), [`a44b2c4`](https://github.com/ogygiajs/ogygia/commit/a44b2c4a60f1391aa01e5f872a26b44ddcf4fb14), [`9d5cdfa`](https://github.com/ogygiajs/ogygia/commit/9d5cdfa5a63c5b058aab29c235b2f8fd16f0b190), [`4d7af4c`](https://github.com/ogygiajs/ogygia/commit/4d7af4c879493fc81c6491c8e71fdc35159195bf), [`c7c1514`](https://github.com/ogygiajs/ogygia/commit/c7c1514154c90fbcf8d7abc7d08aa283c4798ccf), [`e2ea18d`](https://github.com/ogygiajs/ogygia/commit/e2ea18de7542130788504b1c7ccc370145ca7dec), [`94f89d5`](https://github.com/ogygiajs/ogygia/commit/94f89d5836ded01af03afbd5b294f682010e5161), [`a8c1cb4`](https://github.com/ogygiajs/ogygia/commit/a8c1cb492ab1ec401dd74c9f30927a19667309d5), [`b60d52f`](https://github.com/ogygiajs/ogygia/commit/b60d52ffd442da8707e341cc503e5a70059b00be), [`33dc452`](https://github.com/ogygiajs/ogygia/commit/33dc4528c2f6d188fe4ccd0fbbef7d2b8bb9b06c), [`5a43fea`](https://github.com/ogygiajs/ogygia/commit/5a43feaf0a0bcedb2bbfa9d4955a3e9e923fb6c7), [`81e1725`](https://github.com/ogygiajs/ogygia/commit/81e1725dfda91278f685ec45d81c5c928fd52749), [`0a40057`](https://github.com/ogygiajs/ogygia/commit/0a400570963a8bd5092afb4ad3458dce5878432a), [`98730f8`](https://github.com/ogygiajs/ogygia/commit/98730f80ddfef822c16ab7a21800326b9656ad5f), [`e61ca82`](https://github.com/ogygiajs/ogygia/commit/e61ca82de61bbd879ad22b4341042aba0123a1a4), [`bab2aff`](https://github.com/ogygiajs/ogygia/commit/bab2aff60f5e3d10c4f1136f2ad8bfafd2e68efb), [`6bd663c`](https://github.com/ogygiajs/ogygia/commit/6bd663cffbf1f2fb94488b124e8b843a64168025), [`c19ba92`](https://github.com/ogygiajs/ogygia/commit/c19ba9257bed55632bbe18fb1aeb90e1c8eed689), [`08e5c16`](https://github.com/ogygiajs/ogygia/commit/08e5c167a58680dc7ce05620db033ed0fab9d9cf), [`0e4f3a8`](https://github.com/ogygiajs/ogygia/commit/0e4f3a80d7736b5f018e74071760f2a8f2bd2444), [`1e96c8c`](https://github.com/ogygiajs/ogygia/commit/1e96c8c4cd02421a050bb6fab33ff5265425f438), [`0ecb8af`](https://github.com/ogygiajs/ogygia/commit/0ecb8afffd51007af82345e981a5ca0040b07693), [`78f3edd`](https://github.com/ogygiajs/ogygia/commit/78f3eddb26eb19f513c3ab237a8513f609128242), [`99ceeb4`](https://github.com/ogygiajs/ogygia/commit/99ceeb47dc9e7abeccad6b7ceaf7d9053307ce13), [`08fd293`](https://github.com/ogygiajs/ogygia/commit/08fd2937c323bdbbaac6ca0f3dac694dfff9d786), [`9f7eac5`](https://github.com/ogygiajs/ogygia/commit/9f7eac5020cbe1c74fc030a302ff8b1c8f17fcb6), [`53e96f0`](https://github.com/ogygiajs/ogygia/commit/53e96f00b653f74efa8850eb9cce740eb3f9b5fe), [`97d59ed`](https://github.com/ogygiajs/ogygia/commit/97d59ed62c67947d2bac5544f708461157acafd2), [`97d59ed`](https://github.com/ogygiajs/ogygia/commit/97d59ed62c67947d2bac5544f708461157acafd2), [`f848e22`](https://github.com/ogygiajs/ogygia/commit/f848e227447c653eba6878a8a9712c6fff8e087e), [`2bd2d0a`](https://github.com/ogygiajs/ogygia/commit/2bd2d0a6fc88a0b93f5a6b2ca1f01e6d32ade27f), [`69c3a26`](https://github.com/ogygiajs/ogygia/commit/69c3a2683d22dcb7a045329f4c5ac850b74fff7b), [`1e21a17`](https://github.com/ogygiajs/ogygia/commit/1e21a177fa1d5da48c7bccaa15107b0676c60ce1), [`16b6c56`](https://github.com/ogygiajs/ogygia/commit/16b6c56d26563e1db9534e7c3c92acda2bba5f29), [`9299656`](https://github.com/ogygiajs/ogygia/commit/9299656c4bcba0e726f1652fe7eb9924315139ea), [`ea6effb`](https://github.com/ogygiajs/ogygia/commit/ea6effbecb17e8b3e81ef77c82be21ceb756952d), [`ecd3b32`](https://github.com/ogygiajs/ogygia/commit/ecd3b32211fb336e5278113ce7cc2d8c0b08d30f), [`9c6692d`](https://github.com/ogygiajs/ogygia/commit/9c6692d4d39eb824a3af756d7e461b3dd1b8f0a9), [`ee4cebc`](https://github.com/ogygiajs/ogygia/commit/ee4cebcfdaa72cedfb35a68333bb7a0bd646cb7c), [`cea7fe0`](https://github.com/ogygiajs/ogygia/commit/cea7fe0cac9df1017a6e7a43091a9440a96d35ff), [`f878494`](https://github.com/ogygiajs/ogygia/commit/f878494325a282256a45cfe4208585d7350866bc), [`13aa062`](https://github.com/ogygiajs/ogygia/commit/13aa062ec40f5d76e37671e30230dc5f0cb0ab61), [`13aa062`](https://github.com/ogygiajs/ogygia/commit/13aa062ec40f5d76e37671e30230dc5f0cb0ab61), [`8501aa3`](https://github.com/ogygiajs/ogygia/commit/8501aa3a287a9a3e6bdc03c49d5d37fe159a595f), [`b43988f`](https://github.com/ogygiajs/ogygia/commit/b43988f3006a8a9fa4df719b944647151c4b8a23), [`a29b558`](https://github.com/ogygiajs/ogygia/commit/a29b55839110d45b3e61b8c706d07d803ef68b82), [`45632dd`](https://github.com/ogygiajs/ogygia/commit/45632ddc08197386d8c4bfa0bc22b47a395930e7), [`1bc6577`](https://github.com/ogygiajs/ogygia/commit/1bc6577d9b00374245a06e1f05d4821a1e738b14), [`1bc6577`](https://github.com/ogygiajs/ogygia/commit/1bc6577d9b00374245a06e1f05d4821a1e738b14), [`b168cf7`](https://github.com/ogygiajs/ogygia/commit/b168cf7360159f13c8e0d4df87cc3b1ee36f007e), [`13b589f`](https://github.com/ogygiajs/ogygia/commit/13b589fd636055584bc4e231fced8737613317f2), [`4b7d56b`](https://github.com/ogygiajs/ogygia/commit/4b7d56bf94b728c03c9fe5aea86f27d209034831), [`886446f`](https://github.com/ogygiajs/ogygia/commit/886446fc7b3542ad0045364389874685b2bb5186), [`5c3b43c`](https://github.com/ogygiajs/ogygia/commit/5c3b43cb66e430d9a507a6cd35cd63b8dbfe0f8f), [`0845054`](https://github.com/ogygiajs/ogygia/commit/0845054c12ddb4e4e355f121dd29515da97386aa), [`239e0e7`](https://github.com/ogygiajs/ogygia/commit/239e0e703f7cdf523a87ce5e3da8a4a523ab3071), [`295b9a8`](https://github.com/ogygiajs/ogygia/commit/295b9a8fa3ad4df756478e87d471fef3adb5ba98), [`8686f2e`](https://github.com/ogygiajs/ogygia/commit/8686f2e355ecdd04a003fe1ce8a80f9e6580a7c5), [`b823bff`](https://github.com/ogygiajs/ogygia/commit/b823bff47a5b5cecb6e595893f42897754141e55), [`ddbf46e`](https://github.com/ogygiajs/ogygia/commit/ddbf46e998706dade989fa2c6d096fb0d658f558), [`4cfe3ea`](https://github.com/ogygiajs/ogygia/commit/4cfe3eac3d6d244d9b0bae302a571a4331c0da5f), [`9e1480b`](https://github.com/ogygiajs/ogygia/commit/9e1480b2b4a71d85b9897ab3dc1b84dcaee576cc), [`26f7e95`](https://github.com/ogygiajs/ogygia/commit/26f7e95bbdc78ff99ab119e2bdee5173b3f0d6f3), [`dcecc57`](https://github.com/ogygiajs/ogygia/commit/dcecc5774d36a8b9ac1e75d35dde175d163423b6), [`a13ad32`](https://github.com/ogygiajs/ogygia/commit/a13ad3298d9713931d4e3834f179271095129b89), [`5ff44f8`](https://github.com/ogygiajs/ogygia/commit/5ff44f831df630b75c2a6151fa09afea4c164a84), [`19fa62d`](https://github.com/ogygiajs/ogygia/commit/19fa62df5a66032a717a9230816293c52b070dc7), [`096de6c`](https://github.com/ogygiajs/ogygia/commit/096de6c511675e5555f3843860a042a28135246d), [`771fa53`](https://github.com/ogygiajs/ogygia/commit/771fa533c242b5b7a55f2e982e5737e5f11508f7), [`8b120e2`](https://github.com/ogygiajs/ogygia/commit/8b120e2a62fd4529e3959a2ff940ae1bddc807ae), [`5320d28`](https://github.com/ogygiajs/ogygia/commit/5320d28d356ff4232ebebbb09e179d40803d67f8), [`b970e6d`](https://github.com/ogygiajs/ogygia/commit/b970e6d75f549c929f934ec3c55f5c4dabb33ef9), [`90a7449`](https://github.com/ogygiajs/ogygia/commit/90a744948a95004c40088f00f3774406293f320b), [`733aa1c`](https://github.com/ogygiajs/ogygia/commit/733aa1ce9b167fd65386fbef8ad8ef12e7c2274d), [`9762036`](https://github.com/ogygiajs/ogygia/commit/976203688e13378b36a351894cb3d2e595c3f80c), [`07d2165`](https://github.com/ogygiajs/ogygia/commit/07d2165cc8d9fd0de906900292fa6c83f5f1db68), [`0a40057`](https://github.com/ogygiajs/ogygia/commit/0a400570963a8bd5092afb4ad3458dce5878432a), [`cb0633e`](https://github.com/ogygiajs/ogygia/commit/cb0633eec6e9bc0dc371a67bb4d064334070b867), [`94f10fe`](https://github.com/ogygiajs/ogygia/commit/94f10fe870e303386caf0e39d6ea678c240b384c), [`6856e83`](https://github.com/ogygiajs/ogygia/commit/6856e83d1013eac408ea856e95c870302c96208f), [`bae4982`](https://github.com/ogygiajs/ogygia/commit/bae49821e83374a6b2440a965c9902b3ea6386c9), [`32177c7`](https://github.com/ogygiajs/ogygia/commit/32177c785eef04983c7a5687c1944829fa2e0f1e), [`0767267`](https://github.com/ogygiajs/ogygia/commit/07672676193b4c8e20f789aa0c94af455ecb231c), [`62e47da`](https://github.com/ogygiajs/ogygia/commit/62e47da0ed16d662934c754fcacac82a98860e98), [`9c93fb1`](https://github.com/ogygiajs/ogygia/commit/9c93fb1655db4d07cf9fbf43f55ef3ce080f6782), [`9b9f253`](https://github.com/ogygiajs/ogygia/commit/9b9f253baf604bc8783414ed86d79e086a095878), [`b0a4f0e`](https://github.com/ogygiajs/ogygia/commit/b0a4f0ec367fb7742c8a3d30da6d18e1db201dbc), [`5ff44f8`](https://github.com/ogygiajs/ogygia/commit/5ff44f831df630b75c2a6151fa09afea4c164a84), [`88858cc`](https://github.com/ogygiajs/ogygia/commit/88858cc751ffb57d16436c287a67b14e994f3eab), [`1073b6a`](https://github.com/ogygiajs/ogygia/commit/1073b6a86d47169da4897dcd8dbd296956d56868), [`71ff4c7`](https://github.com/ogygiajs/ogygia/commit/71ff4c7db1b6e2616b1589232a5f10dafe08bdfe), [`a14a348`](https://github.com/ogygiajs/ogygia/commit/a14a3484fc8be188578444bb3486e64d5be054ae), [`db542a7`](https://github.com/ogygiajs/ogygia/commit/db542a782a4e3546c342486c41a457fe9f5d2d94), [`fff7b91`](https://github.com/ogygiajs/ogygia/commit/fff7b91e7a34ea452513bc2b5a92ced99322cec5), [`f725fef`](https://github.com/ogygiajs/ogygia/commit/f725fefb1d696c7c92295613d7788133574175f5), [`41f5eec`](https://github.com/ogygiajs/ogygia/commit/41f5eec0c4cffef76bb47d6972035ba7addf0926), [`9201d45`](https://github.com/ogygiajs/ogygia/commit/9201d457b41f0fce8a5e3fccf744ff5a1e7da50f), [`67127a4`](https://github.com/ogygiajs/ogygia/commit/67127a4758c3de93897039a69b39a07938b82afa), [`a403024`](https://github.com/ogygiajs/ogygia/commit/a40302402759af13a9105fbc1e00d0eafed5441f), [`ddbf46e`](https://github.com/ogygiajs/ogygia/commit/ddbf46e998706dade989fa2c6d096fb0d658f558), [`725eb10`](https://github.com/ogygiajs/ogygia/commit/725eb10fc4f022416cd976645f13e6146392a7be), [`b20ae04`](https://github.com/ogygiajs/ogygia/commit/b20ae049ea45cf56581becb1f7a7e95bbaa6f029), [`709372e`](https://github.com/ogygiajs/ogygia/commit/709372e69b9200f8af3a556b9029646fad26f725), [`8bc2778`](https://github.com/ogygiajs/ogygia/commit/8bc2778a860f3aad060c5fa27ab808f4de97def4), [`d70e275`](https://github.com/ogygiajs/ogygia/commit/d70e275a2fb1f85e93f6f7c46d501008b68e8bd7), [`84489df`](https://github.com/ogygiajs/ogygia/commit/84489dfaa8916d5d515edd548a766c4948bacdb2), [`9807aa5`](https://github.com/ogygiajs/ogygia/commit/9807aa5658ffe0b1641db1575086324531a03360), [`dd93a29`](https://github.com/ogygiajs/ogygia/commit/dd93a292f2595549dccdac3ce79219055dfeb95f), [`437e91b`](https://github.com/ogygiajs/ogygia/commit/437e91b816d97a760513b564ad443df4deb35868), [`9df2941`](https://github.com/ogygiajs/ogygia/commit/9df2941c220abfa13f559d333018605962259fa9), [`1b08deb`](https://github.com/ogygiajs/ogygia/commit/1b08debe6cf6a85659a75543d638a4e391551a48), [`1b756bf`](https://github.com/ogygiajs/ogygia/commit/1b756bf1ea08f1ab43d568662ff0bd3fb017f8dc), [`493898d`](https://github.com/ogygiajs/ogygia/commit/493898d8f70b822d4221f2d0fef1d3924460634a), [`acfd819`](https://github.com/ogygiajs/ogygia/commit/acfd81968951124481e7e495e4799ca2076d2d02), [`adef9d0`](https://github.com/ogygiajs/ogygia/commit/adef9d08919ce50cf2febe520a3101cc8026cdef), [`9ef66e4`](https://github.com/ogygiajs/ogygia/commit/9ef66e4666c9bf7d27e6ba9d58882d66d80b98d8), [`dfb60d0`](https://github.com/ogygiajs/ogygia/commit/dfb60d0b1af6448782943a6e1856efc9b5572c38), [`ae5d636`](https://github.com/ogygiajs/ogygia/commit/ae5d636b066c730f68b028b49008b4367f98f8fd), [`dfb60d0`](https://github.com/ogygiajs/ogygia/commit/dfb60d0b1af6448782943a6e1856efc9b5572c38), [`a9072b3`](https://github.com/ogygiajs/ogygia/commit/a9072b35a5736f068bc72916ebf43f23d5f006ea), [`5becc79`](https://github.com/ogygiajs/ogygia/commit/5becc79ed57f9bf6a0b016c7d178d22aa06fb31d), [`e5f7368`](https://github.com/ogygiajs/ogygia/commit/e5f73686d9087864b4212ef0f1b9452c9decac0d), [`368b1da`](https://github.com/ogygiajs/ogygia/commit/368b1da8008b4dd1e44790fc8146a230f2d2da07), [`1398f5f`](https://github.com/ogygiajs/ogygia/commit/1398f5f3f3da843e2be9ad02bf9496e1196695eb), [`3132e4c`](https://github.com/ogygiajs/ogygia/commit/3132e4c83ffda5d264dc768f861527550bbfe942), [`c94c8e0`](https://github.com/ogygiajs/ogygia/commit/c94c8e0cac5696051451aa136d0ced4139dda769), [`4fda955`](https://github.com/ogygiajs/ogygia/commit/4fda955835f6bc298cdb47d75aeebb375c30fd77), [`1497db2`](https://github.com/ogygiajs/ogygia/commit/1497db2a869884f7240cf82492df3c857cc6c1d3), [`0a40057`](https://github.com/ogygiajs/ogygia/commit/0a400570963a8bd5092afb4ad3458dce5878432a), [`4c99764`](https://github.com/ogygiajs/ogygia/commit/4c99764ea887eb4c5a38c6c39bdf1d6bfa768cd6), [`3b77e25`](https://github.com/ogygiajs/ogygia/commit/3b77e255594c28459f2ed9d085c1b4a9be754327), [`11e87f7`](https://github.com/ogygiajs/ogygia/commit/11e87f7689f7b6a6405437eae5bb4803281397d9), [`03b75ac`](https://github.com/ogygiajs/ogygia/commit/03b75ac4ec921b8c2b8fb4272a5ac787fade47d0), [`0602ba2`](https://github.com/ogygiajs/ogygia/commit/0602ba20ede0cf5d4ea444e05bb6351f6fad6ac1), [`c429240`](https://github.com/ogygiajs/ogygia/commit/c42924059f360da15e59b52b8e0a23f850c71242), [`721894d`](https://github.com/ogygiajs/ogygia/commit/721894d044f5d6baed64dd73707711026e4729d7), [`234a23d`](https://github.com/ogygiajs/ogygia/commit/234a23dfbe35ad6139debe8629bc1f9e47368f75), [`c807794`](https://github.com/ogygiajs/ogygia/commit/c80779405740fba544d76e84c49996ec738ebb07), [`08a09ed`](https://github.com/ogygiajs/ogygia/commit/08a09edeadf61984b39b56856af461844b227c67), [`b6b930e`](https://github.com/ogygiajs/ogygia/commit/b6b930e1d4620e543965b187e47a4b059fd62718), [`e29dc84`](https://github.com/ogygiajs/ogygia/commit/e29dc84c7430ba6fd724368056bf696a3233ef87), [`8216703`](https://github.com/ogygiajs/ogygia/commit/8216703088485ac92e2da02f97d8c0d019d693d7), [`d3fcc32`](https://github.com/ogygiajs/ogygia/commit/d3fcc3200f36838e6e6978cb032b8a6cf3b6e2b6), [`ba47506`](https://github.com/ogygiajs/ogygia/commit/ba47506cb79582a2cbe1d119d9d3952124e69676), [`6be3ece`](https://github.com/ogygiajs/ogygia/commit/6be3ece487c63c91051cc0546a12f6c981c7b3d6), [`42129af`](https://github.com/ogygiajs/ogygia/commit/42129af9753cd074e4ce783f2b2be8859bc56cc1), [`b3bf281`](https://github.com/ogygiajs/ogygia/commit/b3bf28102036bee21e946120f49d1bf1719b69ce), [`e858ae2`](https://github.com/ogygiajs/ogygia/commit/e858ae231926aa678b7b619d52e1fcec7333e714), [`77b4f8c`](https://github.com/ogygiajs/ogygia/commit/77b4f8c36e2c31cec535e8ce489b805b0bc6ecd4), [`5b7f197`](https://github.com/ogygiajs/ogygia/commit/5b7f197b800e74b1bba759a171b7006dfa54c0fc), [`5442971`](https://github.com/ogygiajs/ogygia/commit/54429719a66e13b6c194a6e55c95fd66eda08f3f), [`493898d`](https://github.com/ogygiajs/ogygia/commit/493898d8f70b822d4221f2d0fef1d3924460634a), [`95dc4e3`](https://github.com/ogygiajs/ogygia/commit/95dc4e3702a824d66df5cb80d960985e5b1e6bc8), [`779fa59`](https://github.com/ogygiajs/ogygia/commit/779fa59fbcb644bb72076a83c54b96a45bf57e00), [`779fa59`](https://github.com/ogygiajs/ogygia/commit/779fa59fbcb644bb72076a83c54b96a45bf57e00), [`c92ebbb`](https://github.com/ogygiajs/ogygia/commit/c92ebbb4a0771228b655fd7c731a0bd83a58982a), [`4282ea0`](https://github.com/ogygiajs/ogygia/commit/4282ea0027362d775469ced8ff9ae7a1c198fb19), [`f3f8389`](https://github.com/ogygiajs/ogygia/commit/f3f8389b4601f54323b0d6915c255ed596d9e076)]:
  - @ogygia/core@0.14.0
  - @ogygia/compiler@0.14.0

## 0.13.1

### Patch Changes

- Updated dependencies [[`b954d0a`](https://github.com/ogygiajs/ogygia/commit/b954d0a4f010117b6aadf5d8562f062012845231), [`00f367d`](https://github.com/ogygiajs/ogygia/commit/00f367d7d2fe14acf3e4eeb112535312850427f9), [`2edf97e`](https://github.com/ogygiajs/ogygia/commit/2edf97e0a62db53cc5dbe644812d70d043efdba8), [`16302da`](https://github.com/ogygiajs/ogygia/commit/16302da608d6fa3b0a67fd1062d29bffbc0a82c5)]:
  - @ogygia/core@0.13.1

## 0.13.0

### Patch Changes

- [#184](https://github.com/ogygiajs/ogygia/pull/184) [`1767110`](https://github.com/ogygiajs/ogygia/commit/1767110f67734bfaffdd6243b3fb3406292746d4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Packages declare `sideEffects` (only their `.css` files run on import), so bundlers drop the modules an app never uses.
- Updated dependencies [[`019b77e`](https://github.com/ogygiajs/ogygia/commit/019b77ebd374f94dfd1df3628f7ad59b314b864c), [`734c4c5`](https://github.com/ogygiajs/ogygia/commit/734c4c53388327aa7deb2ddd3caa1c7ec93509ba), [`25ab8c7`](https://github.com/ogygiajs/ogygia/commit/25ab8c70c2d6faaab6a21294b66d0ef14421811f), [`da577ee`](https://github.com/ogygiajs/ogygia/commit/da577eee8a20d7b8b75bbb3ab86ff110b796b60e), [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f), [`29d8553`](https://github.com/ogygiajs/ogygia/commit/29d8553c9976d34cb39979f37eaedec84767e8b0), [`25ab8c7`](https://github.com/ogygiajs/ogygia/commit/25ab8c70c2d6faaab6a21294b66d0ef14421811f), [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471), [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f), [`7f64cd1`](https://github.com/ogygiajs/ogygia/commit/7f64cd158fa6708561643990a45f99c5a7dba059), [`01dc5b9`](https://github.com/ogygiajs/ogygia/commit/01dc5b99c13cba0e30a96b0ff765865096a76dca), [`a39c26f`](https://github.com/ogygiajs/ogygia/commit/a39c26f10aee2337f9b5bd89288256db7f994ee6), [`e8cd9f7`](https://github.com/ogygiajs/ogygia/commit/e8cd9f7b9cf0695c4d287283d34ce258ef71c10a), [`413e77f`](https://github.com/ogygiajs/ogygia/commit/413e77f339c19a394ea7582685ed04d5858bf352), [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f), [`25ab8c7`](https://github.com/ogygiajs/ogygia/commit/25ab8c70c2d6faaab6a21294b66d0ef14421811f), [`4da8fe4`](https://github.com/ogygiajs/ogygia/commit/4da8fe43af2706401bd54d9f46f87dc15e385960), [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa), [`24c6592`](https://github.com/ogygiajs/ogygia/commit/24c65929db2850cb4923309fce2a23316ff26b56), [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0), [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0), [`7b35e33`](https://github.com/ogygiajs/ogygia/commit/7b35e332fe548cf08cc9f0607496c81eda7dc519), [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0), [`e605070`](https://github.com/ogygiajs/ogygia/commit/e6050700637374f5e62d8601c0402ce98be2ffa4), [`7a4bde1`](https://github.com/ogygiajs/ogygia/commit/7a4bde1d594eb9779bd06ed7f207278068fdf352), [`537c7f3`](https://github.com/ogygiajs/ogygia/commit/537c7f34e9c11debee5489c7962fa4aa3cb55a11), [`f693f50`](https://github.com/ogygiajs/ogygia/commit/f693f506195904eba4efab88708d08f99a168f2a), [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f), [`f693f50`](https://github.com/ogygiajs/ogygia/commit/f693f506195904eba4efab88708d08f99a168f2a), [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f), [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f), [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10), [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0), [`4a45161`](https://github.com/ogygiajs/ogygia/commit/4a451615e0e64816660a95d33c596c6fe5de1dcc), [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0), [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f), [`e605070`](https://github.com/ogygiajs/ogygia/commit/e6050700637374f5e62d8601c0402ce98be2ffa4), [`865eb55`](https://github.com/ogygiajs/ogygia/commit/865eb5534698c803db04195941f05e094a37110b), [`7f64cd1`](https://github.com/ogygiajs/ogygia/commit/7f64cd158fa6708561643990a45f99c5a7dba059), [`7f64cd1`](https://github.com/ogygiajs/ogygia/commit/7f64cd158fa6708561643990a45f99c5a7dba059), [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f), [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471), [`4da8fe4`](https://github.com/ogygiajs/ogygia/commit/4da8fe43af2706401bd54d9f46f87dc15e385960), [`a7ce10d`](https://github.com/ogygiajs/ogygia/commit/a7ce10df35b3a79365dfff98687ed934215e8a36), [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa), [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f), [`f693f50`](https://github.com/ogygiajs/ogygia/commit/f693f506195904eba4efab88708d08f99a168f2a), [`7e7c047`](https://github.com/ogygiajs/ogygia/commit/7e7c047524989498dc272c05c144c377813fac93), [`f693f50`](https://github.com/ogygiajs/ogygia/commit/f693f506195904eba4efab88708d08f99a168f2a), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`f693f50`](https://github.com/ogygiajs/ogygia/commit/f693f506195904eba4efab88708d08f99a168f2a), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`a99a49a`](https://github.com/ogygiajs/ogygia/commit/a99a49a724ecd61ee0e1388a4e659732a73f5939), [`da577ee`](https://github.com/ogygiajs/ogygia/commit/da577eee8a20d7b8b75bbb3ab86ff110b796b60e), [`e788339`](https://github.com/ogygiajs/ogygia/commit/e7883395dfde86ed2d01a3fa87440589e634c866), [`7b35e33`](https://github.com/ogygiajs/ogygia/commit/7b35e332fe548cf08cc9f0607496c81eda7dc519), [`7b35e33`](https://github.com/ogygiajs/ogygia/commit/7b35e332fe548cf08cc9f0607496c81eda7dc519), [`da577ee`](https://github.com/ogygiajs/ogygia/commit/da577eee8a20d7b8b75bbb3ab86ff110b796b60e), [`28e957d`](https://github.com/ogygiajs/ogygia/commit/28e957d1542aa8a4864e0c865e05b282383dcaed), [`9272db9`](https://github.com/ogygiajs/ogygia/commit/9272db994d85da6bbb68e0220f7087db4ad4e4a2), [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471), [`a5d28b0`](https://github.com/ogygiajs/ogygia/commit/a5d28b07f9b778c6d37c016a227ecaae6b8f67b6), [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471), [`734c4c5`](https://github.com/ogygiajs/ogygia/commit/734c4c53388327aa7deb2ddd3caa1c7ec93509ba), [`debb73b`](https://github.com/ogygiajs/ogygia/commit/debb73b3894e1f0b3286291bbdd4c7da404aee7e), [`e788339`](https://github.com/ogygiajs/ogygia/commit/e7883395dfde86ed2d01a3fa87440589e634c866), [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0), [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f), [`9272db9`](https://github.com/ogygiajs/ogygia/commit/9272db994d85da6bbb68e0220f7087db4ad4e4a2), [`9272db9`](https://github.com/ogygiajs/ogygia/commit/9272db994d85da6bbb68e0220f7087db4ad4e4a2), [`6a63ecf`](https://github.com/ogygiajs/ogygia/commit/6a63ecf2d7e281ca739121de0219b65c4c4d53a7), [`24c6592`](https://github.com/ogygiajs/ogygia/commit/24c65929db2850cb4923309fce2a23316ff26b56), [`24c6592`](https://github.com/ogygiajs/ogygia/commit/24c65929db2850cb4923309fce2a23316ff26b56), [`e605070`](https://github.com/ogygiajs/ogygia/commit/e6050700637374f5e62d8601c0402ce98be2ffa4), [`cc047cc`](https://github.com/ogygiajs/ogygia/commit/cc047ccbe9dffe6d2e0c8bc7375a90cf305300e4), [`e6aed57`](https://github.com/ogygiajs/ogygia/commit/e6aed574326ab5b560e0a0c7c8a76576c9beea08), [`e6aed57`](https://github.com/ogygiajs/ogygia/commit/e6aed574326ab5b560e0a0c7c8a76576c9beea08), [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10), [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471), [`734c4c5`](https://github.com/ogygiajs/ogygia/commit/734c4c53388327aa7deb2ddd3caa1c7ec93509ba), [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f), [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f), [`4b63071`](https://github.com/ogygiajs/ogygia/commit/4b6307151e19db24e00721aa479ac967e9e4b539), [`4b63071`](https://github.com/ogygiajs/ogygia/commit/4b6307151e19db24e00721aa479ac967e9e4b539), [`4b63071`](https://github.com/ogygiajs/ogygia/commit/4b6307151e19db24e00721aa479ac967e9e4b539), [`4b63071`](https://github.com/ogygiajs/ogygia/commit/4b6307151e19db24e00721aa479ac967e9e4b539), [`346c692`](https://github.com/ogygiajs/ogygia/commit/346c6926d79a594596263791de6a811578f9f0e1), [`e605070`](https://github.com/ogygiajs/ogygia/commit/e6050700637374f5e62d8601c0402ce98be2ffa4), [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f), [`c781aeb`](https://github.com/ogygiajs/ogygia/commit/c781aeb6e06d6416a4c930dc02e7199fea3eaee0), [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0), [`b10c054`](https://github.com/ogygiajs/ogygia/commit/b10c0546eed0e1948265ccea2dcdfa47b70e71ef), [`2a970fe`](https://github.com/ogygiajs/ogygia/commit/2a970fe34c02f9051aa67366451cf92595e43339), [`469d980`](https://github.com/ogygiajs/ogygia/commit/469d980bdd0b52bb6bb63575bb7f4f4624ec61e6), [`e788339`](https://github.com/ogygiajs/ogygia/commit/e7883395dfde86ed2d01a3fa87440589e634c866), [`7b35e33`](https://github.com/ogygiajs/ogygia/commit/7b35e332fe548cf08cc9f0607496c81eda7dc519), [`7a53a56`](https://github.com/ogygiajs/ogygia/commit/7a53a56105714777cc3282552f52ddffc08e5414), [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471), [`4da8fe4`](https://github.com/ogygiajs/ogygia/commit/4da8fe43af2706401bd54d9f46f87dc15e385960), [`346c692`](https://github.com/ogygiajs/ogygia/commit/346c6926d79a594596263791de6a811578f9f0e1)]:
  - @ogygia/core@0.13.0

## 0.12.3

### Patch Changes

- Updated dependencies [[`a2eade9`](https://github.com/ogygiajs/ogygia/commit/a2eade9cebe01c844d8ba3106945acadf05b10a8)]:
  - @ogygia/core@0.12.3

## 0.12.2

### Patch Changes

- Updated dependencies [[`2a4dc9c`](https://github.com/ogygiajs/ogygia/commit/2a4dc9c9d83adf14c56b1ae714a7044088b7b8ff)]:
  - @ogygia/core@0.12.2

## 0.12.1

### Patch Changes

- Updated dependencies [[`0f2f6d6`](https://github.com/ogygiajs/ogygia/commit/0f2f6d679562cfc1774c645a8a31a06e17070b76)]:
  - @ogygia/core@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies [[`64f6046`](https://github.com/ogygiajs/ogygia/commit/64f6046512f0cea076b2094d16ed75d4e1c726d3), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba), [`75a5cdd`](https://github.com/ogygiajs/ogygia/commit/75a5cdd66de1b96f45585119b03f2ba4fc7a03ec), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba)]:
  - @ogygia/core@0.12.0

## 0.11.5

### Patch Changes

- Updated dependencies [[`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38), [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38), [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38), [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38)]:
  - @ogygia/core@0.11.5

## 0.11.4

### Patch Changes

- Updated dependencies [[`fede66a`](https://github.com/ogygiajs/ogygia/commit/fede66ae685497399a257cb2a498516364e8064b)]:
  - @ogygia/core@0.11.4

## 0.11.3

### Patch Changes

- Updated dependencies [[`acce10a`](https://github.com/ogygiajs/ogygia/commit/acce10a8eeebae3abc5289de577a302666bec8a5)]:
  - @ogygia/core@0.11.3

## 0.11.2

### Patch Changes

- Updated dependencies [[`a83fe25`](https://github.com/ogygiajs/ogygia/commit/a83fe2574bab6e098d292e4486fc5dea9e32bca5)]:
  - @ogygia/core@0.11.2

## 0.11.1

### Patch Changes

- Updated dependencies [[`0eced1d`](https://github.com/ogygiajs/ogygia/commit/0eced1d4dc1bd1e5c3507bea40d6aab308099c2a)]:
  - @ogygia/core@0.11.1

## 0.11.0

### Minor Changes

- [#64](https://github.com/ogygiajs/ogygia/pull/64) [`3bff299`](https://github.com/ogygiajs/ogygia/commit/3bff2999bf36c9fb9ae1cf3b7a9c04613cf0bd78) Thanks [@PuruVJ](https://github.com/PuruVJ)! - **Breaking:** features move into plugin packages, each a Vite plugin listed beside `ogygia()` and before `sveltekit()` (`plugins: [ogygia(), flags(), sveltekit()]`; out of order, or without `ogygia()`, the build says so): flags (`@ogygia/flags`, was `ogygia/flag`), frozen pages (`@ogygia/freeze`, was `ogygia/freeze` and `ogygia({ freeze })`), fragment federation (`@ogygia/federation`, was `ogygia/federation`; `mount` moved from `ogygia/router`) and content (`@ogygia/content`, was `ogygia/content*` and `ogygia({ content })`; `ogygia/content/server` is `@ogygia/content/server`, and the svelte config's `ogygia.preprocess()` / `ogygia.extensions()` are `preprocess()` / `extensions()` from `@ogygia/content/vite`), each with its factory from `<package>/vite`. The devtools dock and the profiler move to `@ogygia/devtools`: `ogygia({ devtools, profiler })` becomes `devtools({ dock, profiler })`, `ogygia/profiler*` imports become `@ogygia/devtools/profiler*` (`@ogygia/devtools/profiler`, `/profiler/client`, `/profiler/storage`, `/profiler/storage/sqlite|redis|postgres`), and the event layer `ogygia/devtools` exported is `ogygia/events` (with `ogygia/insights` beside it). `ogygia/testing` is `@ogygia/testing`. The server router is `@ogygia/router` (was `ogygia/router`; list `router()` from `@ogygia/router/vite` so its pages' CSS links — dev warns when a page renders without it), and its typed fetch client `ogygia/router/client` is `@ogygia/router/api` (`POST(schema, …)` endpoints now type-check, and `$infer` carries their verbs). An endpoint handler's `c.params` is now typed strictly by its table key, at the top level, inside `layout()` tables and behind `when()`, and its return type reaches `api()`; `GET<'/p'>(fn)` is gone (a handler written outside its table checks with `satisfies Handler<'/p'>`). A plugin is made with `definePlugin({ name, server, client, options, build })` from `ogygia/vite`, which returns a Vite plugin; its server and browser halves are named by location (`server: import.meta.resolve('./server.ts')`) instead of found by package export name. The command line lives in `@ogygia/cli` (`npx ogygia …` keeps working: `ogygia`'s bin runs it). `ogygia` is now a thin package over `@ogygia/core`; plugins depend on `@ogygia/core`. `ogygia()`'s region options sit at its root: `regions.visible`, `regions.presets`, `regions.ttl` and `regions.maxPageAge` are `visible`, `presets`, `ttl` and `maxPageAge`. `@ogygia/tsdown-plugin-svelte` turns a component's relative `./x.ts` imports into `./x.js` in the shipped component and its types, so sources can import with real extensions. Fixed: a Kit-hydrated (`csr = true`) page could link the stylesheets of every region in the app, depending on how the bundler grouped the server build (newer rolldown, under vite 8.3, did).

### Patch Changes

- [#77](https://github.com/ogygiajs/ogygia/pull/77) [`fd47ef6`](https://github.com/ogygiajs/ogygia/commit/fd47ef6c05fd8ed458be5948610f3bfcbfaa44d7) Thanks [@PuruVJ](https://github.com/PuruVJ)! - **Breaking (plugin API):** a plugin's per-route setting is now a key inside Kit's own `config` page option — `b.routeConfig(key)` / `ctx.routeConfig(key)` replace `b.routeOption(name)` / `ctx.routeOption(name)`, nothing is stripped from route files any more, and the server router's `page()` / `layout()` / `routes()` take `config` instead of `freeze`.

- [#80](https://github.com/ogygiajs/ogygia/pull/80) [`5164260`](https://github.com/ogygiajs/ogygia/commit/51642600be6376f381e68ffcfd175be20a570c80) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Server router: a page's `load` and `actions` (bare, or through `load()` / `action()`) read `c.params` typed by their table key, as endpoints do, and a `params` or `search` schema now types `c.params` / `c.search` with its output.

- [#74](https://github.com/ogygiajs/ogygia/pull/74) [`1d97ecc`](https://github.com/ogygiajs/ogygia/commit/1d97ecc3cae56770ba0f878b15b5b9f5cfbac89f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Types: `import.meta.og.source` is declared, `instrument`'s attrs callback may name fewer arguments than the function takes, and loose `any`s in public types are now `unknown` (`OgygiaDriver.evaluate`, `mount()`'s page data, the router's component type); the profiler timeline's blocks are buttons.
- Updated dependencies [[`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f)]:
  - @ogygia/core@0.11.0

## 0.10.2

### Patch Changes

- [#65](https://github.com/ogygiajs/ogygia/pull/65) [`83ef60a`](https://github.com/ogygiajs/ogygia/commit/83ef60af76617a7c0ec8e47327cb027d5fea1c6b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The repository now lives at github.com/ogygiajs/ogygia; package links point there.

## 0.10.1

### Patch Changes

- [#62](https://github.com/ogygiajs/ogygia/pull/62) [`78c63bc`](https://github.com/ogygiajs/ogygia/commit/78c63bc460c37e22cec1c04685a9e13e33453688) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A `regions.presets` entry takes `fetch` (a deferred hole's timing): 0.10.0 rejected the key, so no deferred preset with a timing could be written.

## 0.10.0

### Minor Changes

- [#33](https://github.com/ogygiajs/ogygia/pull/33) [`6f48146`](https://github.com/ogygiajs/ogygia/commit/6f481468e12cbdacd0e7cda1433334bc00da2dc3) Thanks [@PuruVJ](https://github.com/PuruVJ)! - **Breaking:** a `render: 'deferred'` hole's timing is the new `fetch` key (`with { render: 'deferred', fetch: 'visible' }`); pairing it with `wake` fails the build with the line to write, and `wake` now only means when an island's JS runs.

## 0.9.0

### Minor Changes

- [#51](https://github.com/ogygiajs/ogygia/pull/51) [`c0a7793`](https://github.com/ogygiajs/ogygia/commit/c0a7793ab4f00a40632ffa57e69a0f9a9d14354b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Raised minimums to the versions ogygia is tested on: `svelte` ^5.56.8, `playwright` and `@playwright/test` ^1.62.0 (for `ogygia/testing`), and the `magic-string` dependency ^1.4.5.

- [#51](https://github.com/ogygiajs/ogygia/pull/51) [`c0a7793`](https://github.com/ogygiajs/ogygia/commit/c0a7793ab4f00a40632ffa57e69a0f9a9d14354b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - SvelteKit 3 support, alongside SvelteKit 2: builds no longer fail on `refreshAll` ([#37](https://github.com/ogygiajs/ogygia/issues/37)), islands on csr=true pages get Kit's page, the `$page` store no longer uses the removed `$app/stores`, custom-type remote arguments encode on csr=false pages, and a remote form in an island on a csr=true page no longer reloads the page.

- [#51](https://github.com/ogygiajs/ogygia/pull/51) [`c0a7793`](https://github.com/ogygiajs/ogygia/commit/c0a7793ab4f00a40632ffa57e69a0f9a9d14354b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The `vite` peer is `^8.2.4`: Vite 8, from the first version past its published advisories. SvelteKit 2 and SvelteKit 3 both run on it.

### Patch Changes

- [#51](https://github.com/ogygiajs/ogygia/pull/51) [`c0a7793`](https://github.com/ogygiajs/ogygia/commit/c0a7793ab4f00a40632ffa57e69a0f9a9d14354b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `devalue` is required at `^5.9.3`, the first version with the fixes for its published advisories.

## 0.8.8 - 2026-10-30

### Fixed

- A hole on a page cached across a deploy keeps rendering when its component is unchanged: its URL signs the component it renders (`&r=`), so a new preset, `wake` or build-time `OGYGIA_SECRET` no longer turns it into `unknown-id`.

## 0.8.7 - 2026-10-30

### Added

- `regions.maxPageAge` sets the oldest a cached copy of a page can be and still renew its holes (default 8 days, the old fixed window), for a CDN that keeps pages longer without saying so in `cache-control`.

### Fixed

- A refused hole request says why: its 403 carries `x-ogygia-deny` (`foreign-key`, `sig`, `unknown-id`, …) and `x-ogygia-key`, the answering server's key fingerprint, which every hole URL now also carries as `&k=`.
- The runtime never retries a 403 from the islands endpoint: the fallback stands, and devtools and the profiler show the reason (or that a proxy, CDN or firewall in front answered).
- The signing key is read at first use, so an `OGYGIA_SECRET` the host loads after the server's modules still counts; a production server signing with the build's random key logs it once.

## 0.8.6 - 2026-10-28

### Fixed

- A hole created fresh in the browser (Kit remounting a page whose hydration failed, or an island re-creating a snippet) renders its fallback again, so an on-demand hole whose fallback is its trigger can still be woken (it came back empty in 0.8.5).
- A hole in a live snippet that an island re-creates fetches again by its identity on any page, not only on a Kit-hydrated one.

## 0.8.5 - 2026-10-22

### Changed

- An island inside a live snippet an island renders follows the nested rule: it renders inline and hydrates with that island.
- An island sets `data-hydrated` and fires `ogygia:hydrated` once the live snippets it renders have hydrated too.
- A hole nested in an island renders inline as static HTML, like a lake: its component never ships to the browser, and an island inside it wakes on its own.

### Fixed

- A hole inside a live snippet an island renders stays deferred: it ships its fallback, loads on its schedule and is never bundled into the island (it never loaded before).
- A live snippet that renders a template-root snippet, or reads a `<script module>` import or value, an exported declaration or a `$:` declaration, no longer throws `ReferenceError` at render.
- A lake inside a live snippet an island renders keeps its frozen region, so the island inside it wakes and the lake's HTML is no longer discarded beside other snippet content.
- A live snippet an island renders reads the page's contexts on the server and in the browser, as the island does.
- An island inside a frozen snippet wakes on its own.
- A snippet passed to an island on a Kit-hydrated page no longer causes a hydration mismatch.
- A hole on a Kit-hydrated page keeps its address and its landed HTML through Kit's hydration (a hole inside an island could go empty).
- With an app transform, a router navigation no longer leaves a web component's server tree in the light DOM of a live host its own runtime already unpacked (a site nav collapsed to one unstyled item): a page the router fetches is rendered as an answer, every host restored before the swap.
- A first-load copy of a transformed page that reaches the router (a frozen page, a prerender, a cache that ignores `Vary`) is loaded instead of swapped in; transformed documents vary on `x-ogygia-spa`.
- A link inside a web component's shadow tree honors the `data-sveltekit-reload` around the component.

## 0.8.4 - 2026-10-22

### Fixed

- ogygia always uses the app's SvelteKit: a second copy resolved from ogygia's own location (a linked ogygia whose peer resolved another Kit) left the devtools' server events, the freeze verdict and the page seed without their request.
- A hole's answer morphed into a custom element with a shadow root keeps the answer's order: a reordered or newly shown child no longer stays in or lands at the wrong place.
- A baked held region on a Kit-hydrated page no longer throws a hydration mismatch that emptied it: the region element is adopted as it stands, like a lake's.
- Islands inside a baked held region on a Kit-hydrated page wake on the runtime instead of being left to Kit, which never hydrates them.
- Custom elements inside a baked held region keep what the server's transform wrote (a closed dropdown no longer loses `hidden` and shifts the page).

## 0.8.3 - 2026-10-19

### Added

- `ogygia/testing`: `record(actions, { blockNavigation: true })` holds back any document load the actions cause, keeps the page and lists each in `navigations` with what started it, seen as it began (the link, form or input being handled; `approx` where the browser cannot say).
- `ogygia/testing`: `compare()` and `toMarkdown()` also report hydration per island instance, session counts (errors, shifts, slow interactions, blocked navigations, CLS) and vitals past a noise threshold (`compare(base, head, { noise })`), and take several runs a side (`{ test, runs }`): load signals by median, session signals only when every head run has them and no base run does.
- `ogygia/testing`: each `hydration()` island has a `key` per instance (`Name#n` in page order, or the `islandKey` attribute on it or its nearest ancestor, across shadow roots) and its wake times (`t0`, `done`); session findings carry `names`; a session's `counts.cls` is a number, and `toMeetBudget({ cls })` reads it.
- `ogygia/testing`: `playwrightDriver(page, { onNavigationHeld })` and `turnOnDevtools(page, baseURL)`, the fixture's own pieces, for a test that holds its pages itself.
- `ogygia/testing`: every report names the page's testing engine (`engine.version`, `engine.lean`); against a site on an older ogygia, `record()` fills in `navigations` from the loads it held, and one warning per site is logged for the whole run.
- `ogygia/testing`: a `changed` island says whether only attributes differ (`attributesOnly`, with each in `attributes`) and whether input landed on it while it hydrated (`inputDuringHydration`); `ignoreAttributes` leaves chosen attribute changes out, and `toHydrateCleanly({ allowAttributeChanges, allowInput })` lets them through.
- `ogygia/testing`: `page().self` says what measuring cost the page (`script_ms`, the testing engine's `bytes`), and lean testing (`lean: true`, the `og_testing=lean` cookie) runs the testing API and nothing else of devtools, so the page loads what a visitor's does.
- `ogygia/testing`: `page().route` (the SvelteKit route id), `cpuFunctions` for more than 15 of `page().cpu.fns`, and a session's `failed` requests and slowest interaction per element (`by_element`).
- Profiler: `record(…, { server: true })` works across the instances of a serverless deployment: the window's signed id rides each of the session's requests, every instance writes them to the profiler store, and stop on any instance gathers them (`window.instances`); a window that fails leaves the session whole with `server: { error }`.
- Profiler: the JSON report names its `engine.version`; `?fields=` (`profile(path, { fields })`) answers only the sections asked for; `?weigh=full` weighs every file with no time budget, and each file it could not weigh says why (`assets.missed_why`).
- A page with devtools switched on is sent `Document-Policy: js-profiling`, so the browser's CPU sampler can run on it.

### Changed

- `OgygiaDriver.evaluate` is loosely typed, so a driver's `page.evaluate` fits without a cast.
- A pkg.pr.new preview is versioned `<next patch>-next.<commit>`, never the release it was built after.

### Fixed

- `record()` whose page left for another document now says so, with the actions' own error as `cause`, instead of "serve with devtools".
- `withOgygia` turns devtools on for the first page a test opens when there is no `baseURL`; before, it was silently left off.
- A page with devtools switched on is sent `private, no-store` with `Vary: Cookie` and is never frozen, so a shared cache cannot hand its events to other visitors; a profiler beacon page too.
- A hole's `Server-Timing` reaches a browser that switched devtools on (it checked an old cookie value).
- A profiler window whose stop never came frees its instance at its 60 s cap; before, that instance refused every later window.
- A file the profiler failed to weigh by a timeout is weighed again on the next profile; before, it stayed a miss for the life of the instance.
- Devtools' Page and Timeline tabs, and `page()`, stay on the page after a router navigation that never swapped it (handed to the browser and held back, or overtaken); before, they reported no islands.
- On Windows, ogygia knows its own files again: builds no longer register its devtools and profiler components as app modules or warn that its own marks are ignored.
- The dev dependency scan no longer fails when the profiler is on, so dependencies pre-bundle again; `devalue` is now named through ogygia, so pnpm apps stop warning that it can't be resolved.
- A click on a `load`, `idle`, `visible` or media island before it is live is no longer lost: the island wakes at once and the click is replayed when it is live, as on an `interaction` island; `hydratedBy()` then says `'interaction'`.
- A Ctrl/Cmd/Shift- or middle-click on a link in an island that is not live yet opens the link as the browser would; before, it was canceled and replayed, and the replay could not open it.

## 0.8.2 - 2026-10-14

### Changed

- In a build with devtools, the launcher stays hidden until a browser turns devtools on (`?og-devtools=on`, or `ogygia.devtools.on()` in the console); `?og-devtools=off`, `ogygia.devtools.off()` or **hide** in the dock turn it off. The dev server is unchanged.

### Fixed

- A hole's CSS now carries components taken through a package (its `exports`, a TypeScript entry included) or a barrel — only the names imported — and an island inside a hole brings its own CSS, so what it renders after a click is styled.

## 0.8.1 - 2026-10-13

### Fixed

- `handle({ endpoint })` now moves every hole and live-region URL a page mints, not only the handler; before, every hole asked the old `/__ogygia__` path and stayed empty.

## 0.8.0 - 2026-10-09

The **passage** release: the runtime and the compiler rebuilt on one identity primitive, regions that move instead of reset across navigations, a standalone compiler, a production SSR profiler, a devtools dock, a typed router, frozen pages and fragment federation. Underneath, one load scheduler, one DOM ownership model and one page model replace per-path rules.

### Breaking changes

- Flags and experiments collapse onto one primitive, `flag()`; `experiment`, `layer`, `allowOverrides`, `onExposure`, `batchExposures`, `.bucket`, `.on` and `routes({ experiments })` are removed.
  Declare with a shape (`flag('x')`, `flag('x', 10)`, `flag('x', fn)`, `flag('x', { control: 80, bold: 20 })`), read by calling it (`checkout(c)`), branch with `flag.pick(map)` / `flag.pick(c, map)`, read payloads with `flag.value(c)`, configure once with `decide({ source, overrides, exposure, batch })`, and pre-decide in a route-only shell with `routes({ flags: [...] })`.
- `kitMount` is now `mount.kit`.
- `ogygia/rewrite` is now `ogygia/markup` (no alias; change the import).
- `transformHole` is removed; `ogygia.handle({ transform })` covers region answers and documents alike.
- `regionTtl` is now `regions: { ttl }`.
- `regions.preload` is removed; each island's whole graph preloads at its wake.

### Added

- One load scheduler for every download ogygia starts: island code and background work wait for the page's `fetchpriority="high"` resources (or the first input, or a 2.5 s cap), so islands no longer compete with the hero image.
- Holes and regions a remote `query` / `command` renders see their page's `page.url`, route, params and server-load `page.data` (looked up through Kit, only when read), so a server-rendered header can refresh in place ("A lake that can refresh").
- One DOM ownership model for every ogygia DOM writer — who writes inside an element, its attributes, its children's order and their existence — so a web component's own DOM survives repairs, hole answers and navigations.
- SvelteKit 3 support, on the APIs late Kit 2 and Kit 3 share.
- The SSR profiler, `ogygia({ profiler })`: CPU, network, heap and the browser half of a visit, with a 0–100 page score and on-demand mode (`profiler: { onDemand: true }`).
- Devtools, `ogygia({ devtools })`: an island-graph dock with Page, Hydration, Record, Bytes and Profiler tabs, every vital explained down to the island and line responsible.
- `ogygia/testing`: the devtools and the profiler as test primitives.
- `ogygia/router`: Kit's routing, programmatic and fully typed; `document()` renders a complete page from a handle.
- `ogygia/internal/compiler`: the compiler as a standalone, bundler-agnostic engine.
- Frozen pages, `ogygia({ freeze: true })`: a page renders once on write and is served as stored bytes until a publish thaws it (with edge stitching for per-visitor holes).
- Fragment federation: one `federate()`, a remote fragment is a region, and a publish thaws it everywhere.
- The Ref hub: one identity layer for live classes, stores, functions, snippets and held regions that cross an island boundary.
- Transportable values: everything devalue rejects now crosses through one serialization seam; unbridgeable values fail at discovery, not in production.
- A navigation moves regions instead of resetting them (state-delta reconciler); opt-in server-delta navigation renders only what changed (`router: { serverDelta: true }`).
- `ogygia.handle({ transform })`: server transforms that may reshape Svelte-owned markup, restored in the browser before hydration.
- `ogygia/markup` and `scanRegions(html)`: the region round trip for an app that runs a third-party SSR pass over the page.
- On-demand server islands: `render: 'deferred'` + `wake: 'interaction'` fetch nothing until the visitor shows intent.
- `prefetch` warms a deferred hole's HTML before it swaps.
- `keepFallback()`: a server island's answer that keeps the page's fallback.
- `requestEvent()`: Kit's `RequestEvent` inside a server island.
- `isOgygiaPage()`: tells shared code which world it runs in.
- A lake survives Kit hydration on a `csr = true` page.
- `ogygia({ barrels })`: barrel imports become leaf imports at transform time.
- Zero-config library islands: a dependency declares its island roots in its own `package.json`.
- The app's `hooks.client.ts` `init` runs on `csr = false` pages.
- Server islands ship their component tree's CSS; region CSS obeys Kit's `inlineStyleThreshold`.
- Lazy islands download at background priority, so they never fight the first paint.
- Accessible SPA navigation (focus, announcements) and a reason on every page fetch.
- `when()`: flags gate routes, and `pick` chooses infrastructure; OpenFeature interop (`ogygia/flag/openfeature`).
- The build warns when island code reads a context nothing bridges.
- A recovered or healed island says why, and the discard warning names what Svelte threw.
- The ogygia MCP server grows to eleven tools, and the bundled AI skill is rewritten.

### Changed

- A `<Region of={promise}>` waits where the render can: awaited in the server render under Svelte's async mode, streamed as a late region on the server router, or resolved after hydration otherwise.
- Islands inside a region's HTML always wake on the runtime, `csr = true` pages included.
- The page seed ships only when an island reads it, and only the `page.data` keys the page's islands read.
- The remote seed ships only for remotes an island on the page can call.
- Island props reference the page seed instead of copying it, and ride at the end of the body with the module-preload hints.
- Island hints are `fetchpriority="low"`; island wakes start after the page has painted.
- The boot never loads Svelte and is four files fetched in one round trip; the runtime goes right before the page's own JavaScript.
- Duplicate stylesheet links are dropped.
- HTML is byte-identical across renders (window-aligned capability expiry, per-request slot ids).
- The server request path is one request store, one document pass and one walk, and stops allocating per item.
- A slow or hung page can no longer wedge the profiler or the site, and recordings coordinate across processes.
- The Vite plugin is a compiler, and region rendering is region-granular.
- `rolldown` is no longer a dependency: the compiler parses and bundles through the app's Vite, keeping its 16 MB native binary out of production installs.

### Fixed

- Island entries on pages below the root no longer 404 in builds (Kit's `asset()` form comes from the build's Kit version).
- A region moved by another script keeps its in-flight fetch and its woken island.
- Restored shadow roots keep their sheets across a router navigation.
- A preloaded `load` hole stays out of the batch instead of downloading twice.
- Region URLs are pinned to their page, there is one region per hole across path depths, and a navigated island arrives whole in one swap.
- A registry's plain imports keep their CSS on `csr = false` pages; an island inside an island links its own CSS; held regions keep inline sheets.
- A kept island adopts its server DOM instead of discarding it on every load.
- An island with children has the same fingerprint and bytes on every render.
- An island edited while it slept hydrates from its own server markup instead of re-rendering.
- A hole answer that is not the region's (a redirect, a whole document) is refused.
- A deferred hole survives Kit rebuilding a client-on document, and outlives a CDN-cached document.
- A hole's answer morphs over its fallback on every schedule, keeping a web component's attributes and state, unfocused edited fields, and focus visible to assistive tech.
- Region and hole HTML is parsed aware of declarative shadow DOM.
- A lake with no island host survives Kit giving up on the document, and a lake's island with props hydrates on a `csr = true` page.
- An error page under a `csr = false` page renders as the Kit-hydrated document it is.
- A `csr = true` route that imports a block registry no longer links every block's CSS and chunk, and a `csr = false` page links only the island CSS it renders.
- Island entries and the runtime are content-hashed, so a deploy never runs the last build's island code.
- The runtime's hash module is no longer named `fingerprint.js`, which ad blockers blocked.
- A `visible` island's code waits for the viewport, and a scroll-woken island no longer waits on the scheduler.
- An island of ours on a Kit document waits until Kit has applied its page; `requestEvent()` answers under Kit's own render too.
- `goto()` from an island on a Kit-booted page navigates through Kit, and a script module reached through an app alias gets the island's page.
- The router keeps a destination page's inline `<style>` sheets, follows `data-sveltekit-reload`'s grammar, navigates links inside web components in place, corrects the address bar after a server redirect, and keeps the live `<body>` on a fallback swap.
- An unkeyed wrapper around an island survives a sibling inserted above it, and lakes restore by DOM position.
- A layout's csr world derives from the pages it serves, and a `csr = true` page under a `csr = false` layout keeps the layout's chrome.
- `kit.files.routes`, `kit.outDir`, `appDir` and `paths.base` are honoured everywhere, and route walkers follow symlinks.
- Island chunks are emitted only for islands the server bundle can reach.
- Region fingerprints no longer cost 20 ms per island; the profiler is free when it is not profiling.
- `$app/stores` `$page` works inside every ogygia render root, and a server island's `page.url` is the referring page.
- On a `csr = true` page a server island keeps its server-minted endpoint through Kit's hydration, and server-island HTML is absolutized for nested paths.
- `wake: 'interaction'` replays the waking click on the next frame, into the deepest target.
- A `wake: 'none'` lake in a `+layout.svelte` ships its scoped CSS, a lake's or island's scoped CSS keeps its Svelte hash, and the fouc-css fallback ships valid CSS.
- An island inside a server island's `ogygiaFallback` stays a region, and `keepFallback()` from an inline-rendered server island fails with the reason.
- A relative `with { wake }` import inside a `{#snippet}`, a forwarded snippet opening with `{@const}`, and a raw `<style lang="scss">` no longer break or silently skip a component.
- A portable snippet carries its host's style scope, a branded snippet runs in place, and store auto-subscriptions in crossing snippets hoist as snapshots.
- An island's `<svelte:head>` survives a head other scripts edited, and an island's page seed follows dynamic imports.
- The compiler registers only wired transportable classes, and a byte-order-marked source is edited at the right offsets.
- Freeze: a root prefix clears shared stores, and tag sets keep their longest lifetime.
- Dev: CSS authored in holes, regions, islands and frozen snippets applies on first load.
- Dev: every island is a crawl root for Vite's dep scanner, so nothing is discovered late on a cold server.
- Dev: an installed ogygia runs as one copy in the browser.
- Dev: a dep re-optimization no longer strands the islands on an open tab.
- Dev: server islands keep working after an HMR edit of their host file.
- Dev: toggling a route's `csr` export refreshes the server's route set.
- Dev: the nested-island warning no longer crashes SSR.
- Devtools: the dock is styled in a build and under a CSP that refuses inline styles; a wait for a failing first-screen island is not blamed on ogygia.
- Profiler: a page that leaks never takes the server down.
- Profiler: page profiling survives serverless timeouts, and network capture is reliable.
- Profiler: its renders ask as a page navigation, so streamed pages profile as visitors get them.
- Profiler: login survives a large cookie jar, and the dev server runs one live profiler per process.
- Profiler: beacon visits over 64 KB are sent, one beacon per Kit page.
- Profiler: JSON and `.cpuprofile` links download, a `.ogp` moved between machines imports, and the UI ships TS-free templates.

### Internal

- Full TypeScript `strict` at the library level, with `svelte-check` in the library check and zero explicit `any`.
- oxfmt is the workspace formatter.
- The per-host csr context cascade is one per-document signal (`documentIsCsrTrue()`).
- The on-demand-hole browser tests no longer depend on where the runner's pointer rests, and the weekly upstream watcher gained a baseline leg.

## 0.7.0 - 2026-08-20

### Breaking changes

- Unified cross-island context: `<Context of={ctx} value={v}>` and `ctx.get()` are replaced by Svelte's own `setContext` / `getContext`, bridged across islands.

### Added

- `$page.data` (with `form`, `error`, `status`) works inside islands on `csr = false` pages, streamed load promises included.
- Drop-in `setContext`: adopt cross-island context with an import swap.
- A `.ts` registry `with { wake }` binding is mountable.
- `import.meta.og.asRegion(Comp, options)`: the barrel escape hatch for regions.

### Fixed

- A `csr = false` subtree under a `csr = true` ancestor layout islands correctly, also next to a commented-out `csr` export.
- ogygia's own injected imports resolve to ogygia's own files, and its components compile under SSR when the app externalizes it.
- A plain function passed as an island prop errors as a function, not as a snippet.
- The runtime chunk URL busts on the feature set, not only on source.
- `region()` recognizes a `wake:` attach binding, and `keep` splits the region dedupe key.
- Two lakes of the same component restore to the right boxes.
- A held-region import that is only text (a comment, a template literal) is left alone.

### Internal

- One shared region-option parser, one emitter per region kind, and side-channel emits centralized.

## 0.6.6 - 2026-08-19

### Fixed

- A `{#snippet}` forwarded into an island no longer emits duplicate imports.

## 0.6.5 - 2026-08-19

### Removed

- The profiler dashboard's live-server recording mode.

### Fixed

- `ogygia/profiler` is in the published export map.

## 0.6.4 - 2026-08-19

### Added

- Profiler: `×N` call counts and a per-call column, waiting by function, per-caller network attribution, and a serverless dump / upload.

### Fixed

- Profiler: native runtime frames are named instead of rendering as "—".

## 0.6.3 - 2026-08-19

### Fixed

- A `DocsShell` sidebar no longer drowns its own page cross-fade.

## 0.6.2 - 2026-08-19

### Fixed

- A content body's scoped `<style>` no longer vanishes on a `csr = false` page.
- A static server island no longer 404s a bare region id on navigation.
- A page transition between different shells no longer stutters.

## 0.6.1 - 2026-08-19

### Fixed

- Placed client-island CSS no longer vanishes in a production build.

## 0.6.0 - 2026-08-16

### Breaking changes

- Transportable codecs are declared with the `wire` macro (`static [ogygia.wire] = …`).
- The Vite peer is `^7 || ^8` (5 and 6 dropped).
- Island facades are emitted as `og-region.<hash>.js`.
- `continuity.speculate` is removed; SPA mode never emits speculation rules.

### Added

- The config surface: one grammar per `ogygia()` subsystem.
- The site layer, `site()` in `ogygia/content`, with shells and bricks (`Frame`, `DocsShell`).
- The `import.meta.og.*` compile-macro family.
- Region snippets, `region.snippet()`: a snippet that crosses the island boundary.
- Awaitable regions: `await region(Component, props)` bakes the SSR HTML into the ticket.
- `preference()` / `preference.switch()`: site-wide, no-flash visitor preferences.
- A Markdown authoring dialect with VitePress-compatible containers.
- MPA-mode native speculation rules with `router: false`.
- Dev guards: mutating a captured host snapshot inside an island warns.
- `ogygia/profiler`: a drop-in SSR profiler.

### Changed

- Schema layers merge instead of chaining.
- Preloading is render-gated end to end.
- `svelte/server` and the codec graph no longer reach the client.
- Router prefetch also warms the incoming page's island modules.

### Fixed

- A directly used `<Region>` on a `csr = true` page renders inline in the Kit tree.
- An island reading `$app/stores` / `$app/state` no longer bundles Kit's real client store.
- Dev soft-CSS HMR is scoped to the page's own sub-app.
- `csr = false` apps no longer need a token `csr = true` route.
- `folder()` collections no longer come up empty on the dev server.
- Childless islands no longer serialize a phantom `children` slot.
- Nested islands no longer compile in O(2^depth).
- `import.meta.og.code()` in a `.svelte` host is no longer discarded.
- An interrupted navigation no longer logs an unhandled "Transition was skipped" rejection.
- `ogygia/content/slot` resolves.
- Shell reactivity and accessibility fixes (version switcher, element overrides, tab groups).

### Security

- A dev-server path traversal in the FOUC CSS virtual is closed.
- The region batch endpoint rejects oversized bodies (413) before reading them.
- A full audit of the signed-capability pipeline.

## 0.5.1 - 2026-08-13

### Fixed

- Published `exports` resolve to `dist`, not `src`.
- The browser runtime no longer disappears to tree-shaking.

## 0.5.0 - 2026-08-12

### Breaking changes

- The SPA router is global; the `<Router/>` component is removed.
- Content `render()` and `renderHtml()` are replaced by the entry's `body` (a region) with `get()` + `<Region>`.
- `OgygiaBoundary` is now `Boundary`.
- `ogygiaHandle` is now `handle`, exported from `ogygia/server` (`ogygia/hooks` stays as an alias).
- The default island endpoint is `/🏝️`.
- Presets speak the `render` / `wake` grammar.
- `@ogygia/content` is merged into ogygia.

### Added

- Live regions: LiveView over `query.live`.
- Streaming server islands (opt-in, `ogygia({ stream: true })`).
- Regions: `region(Component, props)`, a server-chosen renderable placed like data, with dual-face regions and `ogygia.transport`.
- `content` is part of ogygia (`ogygia/content`).
- One config surface in `ogygia({ … })`, and a namespace API (`import * as ogygia from 'ogygia'`).
- `npx ogygia init` wires a SvelteKit project in one step.
- Async regions: `<Region of={promise}>` owns the full wait.
- `blocks.resolve(tree, registry)` resolves a data tree to regions.
- Per-hole browser cache, `maxAge`.
- `ogygia.script()`: an inline `<script>` from one plain object.
- The `Fallback<P>` type for a deferred island's fallback slot.
- `ogygia/internal/compiler`: the pure transform engine.
- Zero-file all-`csr = false` apps.

### Changed

- Deferred holes are dynamic by default (`Cache-Control: no-store`).
- `ogygia.preprocess()` is synchronous.
- Content sources are trimmed; the mdsvex source is `markdown()`.
- The island endpoint is matched independently of `paths.base`.

### Fixed

- Router back/forward swaps the page, and prefetched pages are used on click.
- The `$app/state` page snapshot reaches islands, and updates after SPA navigation in dev.
- Lakes survive client hydration.
- Content-page islands build, and a standalone client build keeps SSR island registrations.
- Deferred regions hydrate on `csr = true` pages.
- Phantom modulepreload chunks are dropped.
- Island hydration adopts SSR roots in place (no "hero bounce" reflow).
- No FOUC on the first navigation after a deploy.
- Held-region CSS styles the page, in dev and on serverless adapters.
- A live command refresh with only refresh keys works.
- The morph keeps form state with a keyed diff.

## 0.4.3 - 2026-08-07

### Fixed

- `invalidateAll` is a soft seed refresh, not a body swap and view transition.
- `csr = false` FOUC CSS no longer double-owns island component JS, and client stubs keep the entry import that carries island CSS.

## 0.4.0 - 2026-08-07

### Breaking changes

- Portable island bindings: a marked import rewrites the binding itself to an island wrapper, so `<A />`, dynamic components and `{#each}` lists of components work; host children on island call sites are a build error (except `ogygiaFallback`).

### Changed

- Dedupe is identity-based: the same component and options make one wrapper and one client entry, however many call sites.
- `csr = false` client hosts no longer pull island wrappers into Kit's client graph.
- The plugin uses `build.rolldownOptions` on Vite 8.
- Props are real Svelte props into the wrapper, and `ogygiaFallback` is a normal snippet prop.
- Lakes are portable wrappers too.

### Removed

- The static-tag-only requirement, and the tag-hoist virtual modules.

## 0.3.5 - 2026-08-07

### Fixed

- Nested server and deferred-client islands keep their authored attributes.

## 0.3.4 - 2026-08-07

### Added

- Deferred client islands: `with { defer, hydrate }` fetch signed HTML on one schedule and hydrate it on another (matching schedules coalesce).

### Changed

- `defer` + `hydrate` is no longer a build error; `hydrate: 'none'` + `defer` warns in dev and is treated as defer-only.

## 0.3.3 - 2026-08-07

### Changed

- `hydrate: 'load'` also modulepreloads the island's dependency chunks.

## 0.3.2 - 2026-08-07

### Changed

- One runtime bootstrap per page, and `load` preload hints hoisted to the head.

### Fixed

- Relative island entries on nested routes resolve against the document, not the runtime module.

## 0.3.1 - 2026-08-07

### Fixed

- The client build no longer emits thin island entry facades.

## 0.3.0 - 2026-08-06

### Changed

- A hydrate island's `entry` is an importable module URL in production, and the runtime no longer embeds an app-wide regions map.
- Each hydrate island is emitted at a deterministic `ogygia-island.<id>.js`, and SSR renders the same virtual island module the client hydrates.

### Fixed

- Dev: `asset()` no longer rewrites Vite `/@id/…` URLs, and props stay the region's immediate sibling.
- SSR and the client share one virtual tree, ending hydration mismatches on captured props.

## 0.0.0

Initialize package.
