# @ogygia/core

## 0.13.0

### Minor Changes

- [#174](https://github.com/ogygiajs/ogygia/pull/174) [`413e77f`](https://github.com/ogygiajs/ogygia/commit/413e77f339c19a394ea7582685ed04d5858bf352) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A page discloses which ogygia it runs on `window.__ogygia.v` (a Set of versions, as Svelte's `window.__svelte.v`), on csr=false and csr=true pages alike.

- [#175](https://github.com/ogygiajs/ogygia/pull/175) [`a99a49a`](https://github.com/ogygiajs/ogygia/commit/a99a49a724ecd61ee0e1388a4e659732a73f5939) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Every ogygia error and warning has a code and a page at `ogygiajs.dev/e/<code>`: dev prints the wording and the link, a production build prints the link alone (`[ogygia] https://ogygiajs.dev/e/<code>?<args>`), so the wording stays out of the client and server bundles.

### Patch Changes

- [#226](https://github.com/ogygiajs/ogygia/pull/226) [`019b77e`](https://github.com/ogygiajs/ogygia/commit/019b77ebd374f94dfd1df3628f7ad59b314b864c) Thanks [@PuruVJ](https://github.com/PuruVJ)! - In dev, a barrel saved while a transform resolves through it is built again: the build in flight stores nothing and its callers get the new export map, instead of imports rewritten to the old files until the next edit ([#200](https://github.com/ogygiajs/ogygia/issues/200)).

- [#258](https://github.com/ogygiajs/ogygia/pull/258) [`734c4c5`](https://github.com/ogygiajs/ogygia/commit/734c4c53388327aa7deb2ddd3caa1c7ec93509ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Barrel imports in dev now resolve each leaf with the environment that asked: a leaf the client and the server resolve to different files (by conditions) no longer gets the other one's file, from a transform running at the same time or from the cached barrel map ([#252](https://github.com/ogygiajs/ogygia/issues/252)).

- [#256](https://github.com/ogygiajs/ogygia/pull/256) [`25ab8c7`](https://github.com/ogygiajs/ogygia/commit/25ab8c70c2d6faaab6a21294b66d0ef14421811f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A batch hole stream whose visitor leaves now stops: the holes not rendered yet never render or take a render slot, and the answers that land after it are dropped instead of thrown into the closed stream ([#245](https://github.com/ogygiajs/ogygia/issues/245)).

- [#316](https://github.com/ogygiajs/ogygia/pull/316) [`da577ee`](https://github.com/ogygiajs/ogygia/commit/da577eee8a20d7b8b75bbb3ab86ff110b796b60e) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A batch of a page's holes stops when the visitor leaves the page (or when the navigation that started it is called off), and every way a batch ends lets go of its answer's body, the server's end mark included.

- [#223](https://github.com/ogygiajs/ogygia/pull/223) [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A batch stream that goes quiet for 10 seconds is given up: the holes it still owes fetch on their own instead of keeping their fallback forever ([#214](https://github.com/ogygiajs/ogygia/issues/214)).

- [#225](https://github.com/ogygiajs/ogygia/pull/225) [`29d8553`](https://github.com/ogygiajs/ogygia/commit/29d8553c9976d34cb39979f37eaedec84767e8b0) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The profiler's visit beacons no longer take the first tab switch for the page leaving: coming back to the tab or a back/forward cache restore opens the visit again, so later navigations, interactions and shifts go out with the next hide, and the standalone beacon sends no copy after its final visit ([#209](https://github.com/ogygiajs/ogygia/issues/209)).

- [#256](https://github.com/ogygiajs/ogygia/pull/256) [`25ab8c7`](https://github.com/ogygiajs/ogygia/commit/25ab8c70c2d6faaab6a21294b66d0ef14421811f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Concurrent requests for one cached hole (a `maxAge` region) now share one render instead of each rendering it and taking a render slot; a failed render fails the requests that joined it and is not stored ([#244](https://github.com/ogygiajs/ogygia/issues/244)).

- [#321](https://github.com/ogygiajs/ogygia/pull/321) [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An app's callback that throws (a `beforeNavigate` or `afterNavigate` hook, a page store subscriber, a ref watcher or disposer, a source receipt seam, a devtools sink) now reaches the page's error handler (`reportError`), or the console on a server, instead of being dropped; the others still run.

- [#265](https://github.com/ogygiajs/ogygia/pull/265) [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A lazy chunk whose own dependency failed to download is asked for again once, not on every later wake: the runtime then says once that the page needs a reload (`chunk_reload_needed`), and a runtime that fails to load at all now says so too (`runtime_load_failed`) ([#262](https://github.com/ogygiajs/ogygia/issues/262)).

- [#317](https://github.com/ogygiajs/ogygia/pull/317) [`7f64cd1`](https://github.com/ogygiajs/ogygia/commit/7f64cd158fa6708561643990a45f99c5a7dba059) Thanks [@PuruVJ](https://github.com/PuruVJ)! - On a Kit-hydrated page, a custom element Kit removes (and mounts anew) leaves the class watch, and the watch's observer goes once no host is left, instead of holding the removed hosts for good ([#281](https://github.com/ogygiajs/ogygia/issues/281)).

- [#186](https://github.com/ogygiajs/ogygia/pull/186) [`01dc5b9`](https://github.com/ogygiajs/ogygia/commit/01dc5b99c13cba0e30a96b0ff765865096a76dca) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Compiling a page with many regions is up to 1.9x faster: each region import no longer walks the whole file again to learn whether it is used.

- [#302](https://github.com/ogygiajs/ogygia/pull/302) [`a39c26f`](https://github.com/ogygiajs/ogygia/commit/a39c26f10aee2337f9b5bd89288256db7f994ee6) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A waking region no longer searches the whole page for a script that needs devalue: the page is asked once, and again only when new markup comes in, so a 250-region page spends about 0.2 ms on it instead of about 48 ms.

- [#169](https://github.com/ogygiajs/ogygia/pull/169) [`e8cd9f7`](https://github.com/ogygiajs/ogygia/commit/e8cd9f7b9cf0695c4d287283d34ce258ef71c10a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A page whose islands get plain JSON props no longer downloads devalue: it loads only when a props sidecar, the page seed or page facts are in devalue's lane, beside the hydrate code (about 2 KB brotli off each island page of the benchmark).

- [#265](https://github.com/ogygiajs/ogygia/pull/265) [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A click on an island before it is live now acts once, when it wakes: the island waits for what replays the click before it goes live, instead of letting the replay come in later, beside the visitor's next click ([#260](https://github.com/ogygiajs/ogygia/issues/260)).

- [#256](https://github.com/ogygiajs/ogygia/pull/256) [`25ab8c7`](https://github.com/ogygiajs/ogygia/commit/25ab8c70c2d6faaab6a21294b66d0ef14421811f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An exposure sink that rejects no longer crashes the server: the failure is logged with a message code, and the sink's send is handed to the platform's `waitUntil` when it has one, so serverless instances no longer cut exposures off. The response never waits for the send ([#243](https://github.com/ogygiajs/ogygia/issues/243)).

- [#384](https://github.com/ogygiajs/ogygia/pull/384) [`4da8fe4`](https://github.com/ogygiajs/ogygia/commit/4da8fe43af2706401bd54d9f46f87dc15e385960) Thanks [@PuruVJ](https://github.com/PuruVJ)! - In Firefox a chunk or island file whose download was dropped is asked for again under a fresh URL, as in the other browsers: a resource-timing status of 0 now reads as no response ([#388](https://github.com/ogygiajs/ogygia/issues/388)).

- [#187](https://github.com/ogygiajs/ogygia/pull/187) [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The build's flag inventory takes time in line with a module's size: each flag's line is found from one pass over the file, not counted again from the top.

- [#340](https://github.com/ogygiajs/ogygia/pull/340) [`24c6592`](https://github.com/ogygiajs/ogygia/commit/24c65929db2850cb4923309fce2a23316ff26b56) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A heading the router focused gives its `tabindex` back when focus leaves it, even after a second navigation focused it again meanwhile (a refresh in place at its `#hash`), or when it is kept across the navigation inside an island: it no longer stays in the tab order with `tabindex="-1"` for good ([#278](https://github.com/ogygiajs/ogygia/issues/278)).

- [#253](https://github.com/ogygiajs/ogygia/pull/253) [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A forced refresh at an address a navigation batch reserved no longer orphans the holes that joined the batch: they wait on the refresh, which settles them with the first frame written there or fails them with its own error, and a hole that binds after the batch ended fetches on its own ([#233](https://github.com/ogygiajs/ogygia/issues/233)).

- [#253](https://github.com/ogygiajs/ogygia/pull/253) [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A page's form restore window ends when the visitor goes on: fields restored on a page no longer leak into the next page's islands within 5 s ([#235](https://github.com/ogygiajs/ogygia/issues/235)).

- [#324](https://github.com/ogygiajs/ogygia/pull/324) [`7b35e33`](https://github.com/ogygiajs/ogygia/commit/7b35e332fe548cf08cc9f0607496c81eda7dc519) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A router navigation after another one that brought Kit's FOUC `<style>` goes in as well, instead of throwing inside the head merge and loading the page whole.

- [#253](https://github.com/ogygiajs/ogygia/pull/253) [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The newest frame a region gets paints last: an older live tick or hole refresh still waiting for its stylesheet no longer paints over a newer one that needed none ([#231](https://github.com/ogygiajs/ogygia/issues/231)).

- [#305](https://github.com/ogygiajs/ogygia/pull/305) [`e605070`](https://github.com/ogygiajs/ogygia/commit/e6050700637374f5e62d8601c0402ce98be2ffa4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A region refresh that starts while a first fetch of the same hole is still out stops that fetch, and the regions that waited on it get the refreshed HTML.

- [#303](https://github.com/ogygiajs/ogygia/pull/303) [`7a4bde1`](https://github.com/ogygiajs/ogygia/commit/7a4bde1d594eb9779bd06ed7f207278068fdf352) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A hydrating region records its `<head>` content from what it added, not by copying and scanning the whole `<head>`: on a 250-region page with a large head this takes about 0.15 ms instead of about 58 ms.

- [#411](https://github.com/ogygiajs/ogygia/pull/411) [`537c7f3`](https://github.com/ogygiajs/ogygia/commit/537c7f34e9c11debee5489c7962fa4aa3cb55a11) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A hole that loads at once is now asked for once in every browser, including Safari: before, Safari asked twice.

- [#339](https://github.com/ogygiajs/ogygia/pull/339) [`f693f50`](https://github.com/ogygiajs/ogygia/commit/f693f506195904eba4efab88708d08f99a168f2a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A hole's island with `wake: 'interaction'` wakes on the visitor's first press or key when the hole's own `when` is another schedule; it used to be armed as the hole's on-demand fetch, which never fired, and stayed server markup for good ([#338](https://github.com/ogygiajs/ogygia/issues/338)).

- [#223](https://github.com/ogygiajs/ogygia/pull/223) [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A hole's fetch, its answer and its island's wake are machines: an island wakes whoever fetched its answer, a kept fallback that later gets an answer wakes too, a failed refetch no longer marks the next answer a refresh, a region with two schedules drops both when it leaves, and an interaction island that fails to wake says so ([#206](https://github.com/ogygiajs/ogygia/issues/206)).

- [#339](https://github.com/ogygiajs/ogygia/pull/339) [`f693f50`](https://github.com/ogygiajs/ogygia/commit/f693f506195904eba4efab88708d08f99a168f2a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A hole put back on the page after a while off it shows its answer again and wakes its island, instead of showing nothing (its island had taken its markup with it) or keeping an island nothing wakes, once the frame store let the answer go ([#336](https://github.com/ogygiajs/ogygia/issues/336)).

- [#223](https://github.com/ogygiajs/ogygia/pull/223) [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A renewed hole capability belongs to its address: every copy of the hole that took the answer moves onto it, not only the one that fetched ([#213](https://github.com/ogygiajs/ogygia/issues/213)).

- [#223](https://github.com/ogygiajs/ogygia/pull/223) [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A copy of a hole that leaves the page gives up only its own place in the shared fetch: its twin's retry is no longer cancelled, and a twin that joined a batch no longer waits forever ([#205](https://github.com/ogygiajs/ogygia/issues/205)).

- [#173](https://github.com/ogygiajs/ogygia/pull/173) [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Islands hydrate the component itself instead of through a wrapper component: an island page ships less Svelte (about 0.3–0.4 KB brotli), and a placed island's server markup carries one marker pair fewer.

- [#253](https://github.com/ogygiajs/ogygia/pull/253) [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A region put back while its island loads wakes once, and the old run's failure no longer reaches the new visit: no error logged against the new module, no failure report, its drift watch and scheduler place kept ([#230](https://github.com/ogygiajs/ogygia/issues/230)).

- [#387](https://github.com/ogygiajs/ogygia/pull/387) [`4a45161`](https://github.com/ogygiajs/ogygia/commit/4a451615e0e64816660a95d33c596c6fe5de1dcc) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A region or hole answer is parsed in a document with no browsing context, so no engine builds its custom elements before the restore (Firefox 159 did, and the page showed a component's server render twice); a host a component runtime upgraded first keeps its own root, gets its light DOM back without the server's copy, and says `restore_late` in every build ([#382](https://github.com/ogygiajs/ogygia/issues/382)).

- [#253](https://github.com/ogygiajs/ogygia/pull/253) [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An early-click capture ends only its own arming: a region put back while its first wake loaded keeps catching clicks, and the old capture no longer replays its clicks onto the new visit ([#232](https://github.com/ogygiajs/ogygia/issues/232)).

- [#265](https://github.com/ogygiajs/ogygia/pull/265) [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An island whose own file fails to download is asked for again under a fresh URL, at once and by every later wake, like the runtime's lazy chunks: one dropped download no longer leaves the island, and every island of that file, dead for the tab ([#261](https://github.com/ogygiajs/ogygia/issues/261)).

- [#305](https://github.com/ogygiajs/ogygia/pull/305) [`e605070`](https://github.com/ogygiajs/ogygia/commit/e6050700637374f5e62d8601c0402ce98be2ffa4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Two islands of one file whose download fails together share one retry, so the module loads once instead of twice ([#271](https://github.com/ogygiajs/ogygia/issues/271)).

- [#333](https://github.com/ogygiajs/ogygia/pull/333) [`865eb55`](https://github.com/ogygiajs/ogygia/commit/865eb5534698c803db04195941f05e094a37110b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The dev rule that no shared work keeps a failure now checks what is kept now: once that failure is dropped or replaced, it no longer reports it again ([#330](https://github.com/ogygiajs/ogygia/issues/330)).

- [#317](https://github.com/ogygiajs/ogygia/pull/317) [`7f64cd1`](https://github.com/ogygiajs/ogygia/commit/7f64cd158fa6708561643990a45f99c5a7dba059) Thanks [@PuruVJ](https://github.com/PuruVJ)! - On a Kit-hydrated page, the wait for Kit's page ends once no island waits for it: an island that leaves the page while it waits no longer keeps the wait going (its timers and its watch of Kit's page).

- [#317](https://github.com/ogygiajs/ogygia/pull/317) [`7f64cd1`](https://github.com/ogygiajs/ogygia/commit/7f64cd158fa6708561643990a45f99c5a7dba059) Thanks [@PuruVJ](https://github.com/PuruVJ)! - On a global that refuses an accessor on Kit's page symbol, an island waiting for Kit's page now hydrates once Kit publishes it, instead of waiting for good.

- [#223](https://github.com/ogygiajs/ogygia/pull/223) [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The islands inside a remounted swr lake wake once its refresh lands, not only when the refresh fails ([#204](https://github.com/ogygiajs/ogygia/issues/204)).

- [#321](https://github.com/ogygiajs/ogygia/pull/321) [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An inline island a client navigation created whose code fails to load now prints `island_load_failed`, instead of rendering nothing without a word.

- [#384](https://github.com/ogygiajs/ogygia/pull/384) [`4da8fe4`](https://github.com/ogygiajs/ogygia/commit/4da8fe43af2706401bd54d9f46f87dc15e385960) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An island file that 404s is no longer asked for again under a fresh URL when the browser's timing entry for it lands late (Firefox on a busy machine): the loader waits for the entry, up to a second.

- [#215](https://github.com/ogygiajs/ogygia/pull/215) [`a7ce10d`](https://github.com/ogygiajs/ogygia/commit/a7ce10df35b3a79365dfff98687ed934215e8a36) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A lazy runtime chunk (the hydrate core, devalue, the interaction replay) that fails to download is asked for again under a fresh URL, so one dropped request no longer leaves every later island wake in the tab dead ([#201](https://github.com/ogygiajs/ogygia/issues/201)).

- [#187](https://github.com/ogygiajs/ogygia/pull/187) [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Finding the images that downloaded beside a page's largest paint takes time in line with its images.

- [#223](https://github.com/ogygiajs/ogygia/pull/223) [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A live region is one machine: a tick that comes while its island hydrates no longer mounts a second island, turning static disposes the island, and turning interactive stops the static morph ([#211](https://github.com/ogygiajs/ogygia/issues/211)).

- [#339](https://github.com/ogygiajs/ogygia/pull/339) [`f693f50`](https://github.com/ogygiajs/ogygia/commit/f693f506195904eba4efab88708d08f99a168f2a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A live region put back on the page goes on in its last tick's mode: a static one follows the writes at its address again, an interactive one hydrates its island again, instead of both stopping until the next tick ([#337](https://github.com/ogygiajs/ogygia/issues/337)).

- [#315](https://github.com/ogygiajs/ogygia/pull/315) [`7e7c047`](https://github.com/ogygiajs/ogygia/commit/7e7c047524989498dc272c05c144c377813fac93) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `@ogygia/core`: draining the load queue reads each waiting download's class once instead of sorting the whole queue every time a download ends, so a big page spends less time picking what to fetch next, in the same order.

- [#339](https://github.com/ogygiajs/ogygia/pull/339) [`f693f50`](https://github.com/ogygiajs/ogygia/commit/f693f506195904eba4efab88708d08f99a168f2a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A region that leaves the page before its `load` schedule fires starts nothing: no fetch of a hole's answer off the page (which then gave up and reported a failure), and no wake of its island ([#335](https://github.com/ogygiajs/ogygia/issues/335)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A region's mailbox runs any number of events queued in one turn on a flat stack, instead of overflowing it after a few thousand sync ones ([#342](https://github.com/ogygiajs/ogygia/issues/342)).

- [#339](https://github.com/ogygiajs/ogygia/pull/339) [`f693f50`](https://github.com/ogygiajs/ogygia/commit/f693f506195904eba4efab88708d08f99a168f2a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A region whose element leaves the page while one of its waits is queued behind another event ends that wait with `STALE`, instead of leaving it (and the wake or live tick around it) unsettled for good ([#373](https://github.com/ogygiajs/ogygia/issues/373)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A region's mailbox hands each handler a turn of its own: a wait from a handler that does not hold the turn (two waits at once, a timer it left behind) no longer ends another handler's turn and lets two events of one element run at once ([#341](https://github.com/ogygiajs/ogygia/issues/341)).

- [#316](https://github.com/ogygiajs/ogygia/pull/316) [`da577ee`](https://github.com/ogygiajs/ogygia/commit/da577eee8a20d7b8b75bbb3ab86ff110b796b60e) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A navigation called off before its swap (back pressed, a link to the page on screen) takes the next page's stylesheets it put in the head out again, and stops waiting for them at once, instead of leaving them to style the page on screen ([#267](https://github.com/ogygiajs/ogygia/issues/267)).

- [#216](https://github.com/ogygiajs/ogygia/pull/216) [`e788339`](https://github.com/ogygiajs/ogygia/commit/e7883395dfde86ed2d01a3fa87440589e634c866) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Two links clicked while the router chunk downloads: the last one wins, not the first ([#203](https://github.com/ogygiajs/ogygia/issues/203)).

- [#324](https://github.com/ogygiajs/ogygia/pull/324) [`7b35e33`](https://github.com/ogygiajs/ogygia/commit/7b35e332fe548cf08cc9f0607496c81eda7dc519) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The next page's stylesheets load inert while a navigation waits, and style the page only once it goes in: a sheet that arrived first no longer styles the page still on screen ([#267](https://github.com/ogygiajs/ogygia/issues/267)).

- [#324](https://github.com/ogygiajs/ogygia/pull/324) [`7b35e33`](https://github.com/ogygiajs/ogygia/commit/7b35e332fe548cf08cc9f0607496c81eda7dc519) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A navigation whose swap throws (with or without a view transition), or whose devalue fails to load, now ends and goes to the browser with its error said, instead of staying in flight or finishing as if the page went in ([#276](https://github.com/ogygiajs/ogygia/issues/276)).

- [#316](https://github.com/ogygiajs/ogygia/pull/316) [`da577ee`](https://github.com/ogygiajs/ogygia/commit/da577eee8a20d7b8b75bbb3ab86ff110b796b60e) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The page facts a hole's answer brings are its page's: a navigation that swaps the next page in before any island woke no longer merges them over the next page's `page.data` ([#269](https://github.com/ogygiajs/ogygia/issues/269)).

- [#298](https://github.com/ogygiajs/ogygia/pull/298) [`28e957d`](https://github.com/ogygiajs/ogygia/commit/28e957d1542aa8a4864e0c865e05b282383dcaed) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A value the page seed cannot carry (a function, a symbol, an unknown class) is left out where it sits, so regions still get the rest of `page.data`, `form` and `error` instead of `undefined`.

- [#370](https://github.com/ogygiajs/ogygia/pull/370) [`9272db9`](https://github.com/ogygiajs/ogygia/commit/9272db994d85da6bbb68e0220f7087db4ad4e4a2) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A streamed `$page.data` promise whose value throws as it is staged (a getter that throws) now fails that promise's `{#await}` instead of keeping the response open for good; the other promises still stream and the stream closes ([#367](https://github.com/ogygiajs/ogygia/issues/367)).

- [#321](https://github.com/ogygiajs/ogygia/pull/321) [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A page made for one browser (devtools events, the profiler's beacon) whose headers cannot be changed now prints `personal_response_unmarked`, instead of going out without `private, no-store` and without a word.

- [#221](https://github.com/ogygiajs/ogygia/pull/221) [`a5d28b0`](https://github.com/ogygiajs/ogygia/commit/a5d28b07f9b778c6d37c016a227ecaae6b8f67b6) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A plugin's shared `ask` hook throws when no implementation answered and one threw, instead of answering `undefined` as if nobody knew ([#198](https://github.com/ogygiajs/ogygia/issues/198)).

- [#321](https://github.com/ogygiajs/ogygia/pull/321) [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A plugin's `done` that throws, or whose work fails after the response, now prints `plugin_hook_failed` with the error, instead of nothing; the response still never fails on it.

- [#258](https://github.com/ogygiajs/ogygia/pull/258) [`734c4c5`](https://github.com/ogygiajs/ogygia/commit/734c4c53388327aa7deb2ddd3caa1c7ec93509ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A dev edit that runs a plugin's server half again no longer leaves its old run in the shared hooks: the plugins of the run before leave first, so `notify` reaches only the current ones and `ask` answers from them ([#251](https://github.com/ogygiajs/ogygia/issues/251)).

- [#381](https://github.com/ogygiajs/ogygia/pull/381) [`debb73b`](https://github.com/ogygiajs/ogygia/commit/debb73b3894e1f0b3286291bbdd4c7da404aee7e) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The browser runtime no longer ships the server's render and stream deadlines: each named retry policy is kept only where its code reads it.

- [#216](https://github.com/ogygiajs/ogygia/pull/216) [`e788339`](https://github.com/ogygiajs/ogygia/commit/e7883395dfde86ed2d01a3fa87440589e634c866) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A prefetch answered after a remote mutation cleared the page cache no longer puts the page from before the mutation back ([#208](https://github.com/ogygiajs/ogygia/issues/208)).

- [#253](https://github.com/ogygiajs/ogygia/pull/253) [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An old prefetch no longer forgets a newer prefetch of the same page when its slot comes up after a cache clear, so a click on that page lifts the newer one instead of waiting behind every other guess ([#234](https://github.com/ogygiajs/ogygia/issues/234)).

- [#223](https://github.com/ogygiajs/ogygia/pull/223) [`ad8a29a`](https://github.com/ogygiajs/ogygia/commit/ad8a29a298815800489266abd331a84476e38f0f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `preload()` of a hole fetches it the way the hole does: a `keepFallback()` answer keeps the fallback instead of wiping it, a page or a redirect is refused, and a renewed capability is kept ([#212](https://github.com/ogygiajs/ogygia/issues/212)).

- [#370](https://github.com/ogygiajs/ogygia/pull/370) [`9272db9`](https://github.com/ogygiajs/ogygia/commit/9272db994d85da6bbb68e0220f7087db4ad4e4a2) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A profiler `mark()` made before the page's beacon loads now waits for it however late it comes, instead of being dropped after 10 s; the beacon takes the waiting marks as it loads ([#369](https://github.com/ogygiajs/ogygia/issues/369)).

- [#370](https://github.com/ogygiajs/ogygia/pull/370) [`9272db9`](https://github.com/ogygiajs/ogygia/commit/9272db994d85da6bbb68e0220f7087db4ad4e4a2) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A file the static host could not answer once (a 5xx, a timeout, a network blip) is weighed again by the next profiler report instead of being left out for the life of the process, and reports weighing a file at once share one fetch ([#362](https://github.com/ogygiajs/ogygia/issues/362)).

- [#170](https://github.com/ogygiajs/ogygia/pull/170) [`6a63ecf`](https://github.com/ogygiajs/ogygia/commit/6a63ecf2d7e281ca739121de0219b65c4c4d53a7) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The island prop-mutation warning (a dev aid) no longer ships in production builds: its guard is created only in dev, so the bundler drops it (about 0.4 KB brotli per island page).

- [#340](https://github.com/ogygiajs/ogygia/pull/340) [`24c6592`](https://github.com/ogygiajs/ogygia/commit/24c65929db2850cb4923309fce2a23316ff26b56) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A region stylesheet whose download failed is asked for again by the next answer that carries it, which waits on that download only: the region no longer stays unstyled for the rest of the tab, nor waits 5 s on a sheet that never loads ([#274](https://github.com/ogygiajs/ogygia/issues/274)).

- [#340](https://github.com/ogygiajs/ogygia/pull/340) [`24c6592`](https://github.com/ogygiajs/ogygia/commit/24c65929db2850cb4923309fce2a23316ff26b56) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A hole kept across a navigation keeps its stylesheet: a region sheet stays in the head while a region on the new page still uses it, instead of going with the head merge because the new page's server head does not list it ([#275](https://github.com/ogygiajs/ogygia/issues/275)).

- [#305](https://github.com/ogygiajs/ogygia/pull/305) [`e605070`](https://github.com/ogygiajs/ogygia/commit/e6050700637374f5e62d8601c0402ce98be2ffa4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A cached hole whose first request leaves while its render waits for a slot keeps its place in the render queue for the requests still waiting on it, instead of being rendered again from the back of the queue; a render every request left never takes a slot.

- [#328](https://github.com/ogygiajs/ogygia/pull/328) [`cc047cc`](https://github.com/ogygiajs/ogygia/commit/cc047ccbe9dffe6d2e0c8bc7375a90cf305300e4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A cached region render is keyed by its region, props, session and page as separate fields, so two visitors whose props and session spell one string another way never share a render ([#312](https://github.com/ogygiajs/ogygia/issues/312)).

- [#218](https://github.com/ogygiajs/ogygia/pull/218) [`e6aed57`](https://github.com/ogygiajs/ogygia/commit/e6aed574326ab5b560e0a0c7c8a76576c9beea08) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Hole renders never run above the concurrency limit: a freed slot goes straight to the next waiter, and a render past its timeout gives its slot to the next hole, so renders stuck on a hung upstream never block the others ([#195](https://github.com/ogygiajs/ogygia/issues/195)).

- [#218](https://github.com/ogygiajs/ogygia/pull/218) [`e6aed57`](https://github.com/ogygiajs/ogygia/commit/e6aed574326ab5b560e0a0c7c8a76576c9beea08) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A hole answers within the render timeout, its wait for a render slot included, and the server logs when a render first outlives it ([#195](https://github.com/ogygiajs/ogygia/issues/195)).

- [#173](https://github.com/ogygiajs/ogygia/pull/173) [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A live region and a woken deferred island now adopt their server HTML: they were thrown away and re-rendered on the client every time they hydrated.

- [#321](https://github.com/ogygiajs/ogygia/pull/321) [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A request's owned work now stops at once when its answer is a HEAD or a page SvelteKit turns into a 304, instead of running until the visitor leaves ([#320](https://github.com/ogygiajs/ogygia/issues/320)).

- [#258](https://github.com/ogygiajs/ogygia/pull/258) [`734c4c5`](https://github.com/ogygiajs/ogygia/commit/734c4c53388327aa7deb2ddd3caa1c7ec93509ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A router page's CSS in dev is no longer lost after one failed read of the router CSS registry: the next render reads it again ([#249](https://github.com/ogygiajs/ogygia/issues/249)).

- [#265](https://github.com/ogygiajs/ogygia/pull/265) [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A link the browser keeps the page on screen for (a file download, a 204) works on every click again, not only the first: the router's hand-off of a navigation to the browser now ends it, so a later click on the link no longer joins it and gets swallowed ([#266](https://github.com/ogygiajs/ogygia/issues/266)).

- [#265](https://github.com/ogygiajs/ogygia/pull/265) [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Back from a page the router handed to the browser (a csr=true Kit page, a page that is not ogygia's) now loads the page before it: the router's history entry for the visit is replaced by the browser's document instead of reloaded, so the router page's entry no longer belongs to the new document ([#259](https://github.com/ogygiajs/ogygia/issues/259)).

- [#325](https://github.com/ogygiajs/ogygia/pull/325) [`4b63071`](https://github.com/ogygiajs/ogygia/commit/4b6307151e19db24e00721aa479ac967e9e4b539) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The `hashchange` the router fires for an app-managed fragment link has the address before the click as its `oldURL` ([#277](https://github.com/ogygiajs/ogygia/issues/277)).

- [#325](https://github.com/ogygiajs/ogygia/pull/325) [`4b63071`](https://github.com/ogygiajs/ogygia/commit/4b6307151e19db24e00721aa479ac967e9e4b539) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The router writes a history entry only when a page goes in: download and 204 clicks add none, and a download sent as HTML (`Content-Disposition: attachment`) is saved, not swapped into the page ([#297](https://github.com/ogygiajs/ogygia/issues/297)).

- [#325](https://github.com/ogygiajs/ogygia/pull/325) [`4b63071`](https://github.com/ogygiajs/ogygia/commit/4b6307151e19db24e00721aa479ac967e9e4b539) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The router keeps the app's own `history.state` on the entries it takes over (the one it starts on, an app's own `pushState` met on Back or Forward, one replaced in place): its id goes beside that state instead of over it ([#375](https://github.com/ogygiajs/ogygia/issues/375)).

- [#325](https://github.com/ogygiajs/ogygia/pull/325) [`4b63071`](https://github.com/ogygiajs/ogygia/commit/4b6307151e19db24e00721aa479ac967e9e4b539) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The router keeps one record of the visitor's history, and every page left keeps its scroll: Forward after Back lands where the page was left, not at the top ([#270](https://github.com/ogygiajs/ogygia/issues/270)).

- [#254](https://github.com/ogygiajs/ogygia/pull/254) [`346c692`](https://github.com/ogygiajs/ogygia/commit/346c6926d79a594596263791de6a811578f9f0e1) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The router's navigation code that fails to download is asked for again under a fresh URL: the next click, `invalidateAll`, `invalidate` or `preloadData` loads it, instead of links falling back to full page loads and refreshes failing until a reload, and a prefetch it fails for warms nothing instead of leaving an uncaught error ([#238](https://github.com/ogygiajs/ogygia/issues/238)).

- [#305](https://github.com/ogygiajs/ogygia/pull/305) [`e605070`](https://github.com/ogygiajs/ogygia/commit/e6050700637374f5e62d8601c0402ce98be2ffa4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A navigation that was waiting on a prefetch when a remote mutation cleared the page cache fetches the page again instead of showing it as it was, a prefetch of a page a navigation is fetching joins that request, and a prefetch the clear ended gives its turn back without fetching.

- [#265](https://github.com/ogygiajs/ogygia/pull/265) [`ee66652`](https://github.com/ogygiajs/ogygia/commit/ee66652b87dc8b1ef6617ef61e0ead2d80ebba1f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A link component that clicks its inner `<a>` again after the visitor's click no longer turns the router's navigation into a full load when that second click never reaches the document (a click event that stays in its shadow root, or an anchor the swap took out of the page): it joins the navigation the first click started ([#263](https://github.com/ogygiajs/ogygia/issues/263)).

- [#329](https://github.com/ogygiajs/ogygia/pull/329) [`c781aeb`](https://github.com/ogygiajs/ogygia/commit/c781aeb6e06d6416a4c930dc02e7199fea3eaee0) Thanks [@PuruVJ](https://github.com/PuruVJ)! - In dev, ogygia checks its own rules after each navigation and machine move (one mount per region, the address bar matches the router's history, nothing of a left page stays open, no failure leaves without a code) and after each response (a request's work ends with it, no shared work keeps a failure), and says a broken one with its code; a production build ships none of them ([#313](https://github.com/ogygiajs/ogygia/issues/313)).

- [#253](https://github.com/ogygiajs/ogygia/pull/253) [`b60df97`](https://github.com/ogygiajs/ogygia/commit/b60df977471b64de3e40e1a99ff083057ff82da0) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The hydration scheduler wakes at its earliest wait: a short wait for a region's viewport report set during a long hold no longer waits out the hold ([#236](https://github.com/ogygiajs/ogygia/issues/236)).

- [#300](https://github.com/ogygiajs/ogygia/pull/300) [`b10c054`](https://github.com/ogygiajs/ogygia/commit/b10c0546eed0e1948265ccea2dcdfa47b70e71ef) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Handing out hydrate turns costs the same per region however many are waiting: a page with 250 `load` regions spends about a third of the time scheduling them, 2,500 regions about a twentieth.

- [#299](https://github.com/ogygiajs/ogygia/pull/299) [`2a970fe`](https://github.com/ogygiajs/ogygia/commit/2a970fe34c02f9051aa67366451cf92595e43339) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Matching copied records in region props to the page seed takes time in line with the props: a list page whose region gets copies of its products renders its seed references up to 3.5x faster.

- [#380](https://github.com/ogygiajs/ogygia/pull/380) [`469d980`](https://github.com/ogygiajs/ogygia/commit/469d980bdd0b52bb6bb63575bb7f4f4624ec61e6) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A region's viewport snapshot is held by its lifetime with one cleanup instead of a scope of its own, so a hydrate turn costs about what it did before the scheduler moved onto scopes.

- [#216](https://github.com/ogygiajs/ogygia/pull/216) [`e788339`](https://github.com/ogygiajs/ogygia/commit/e7883395dfde86ed2d01a3fa87440589e634c866) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A soft refresh (invalidateAll) still in flight when the visitor navigates no longer merges the old page's head and data into the new one ([#202](https://github.com/ogygiajs/ogygia/issues/202)).

- [#324](https://github.com/ogygiajs/ogygia/pull/324) [`7b35e33`](https://github.com/ogygiajs/ogygia/commit/7b35e332fe548cf08cc9f0607496c81eda7dc519) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `invalidateAll` during a navigation refreshes the page on screen, not the page the navigation is still bringing, and a navigation that goes in ends a refresh still out ([#268](https://github.com/ogygiajs/ogygia/issues/268)).

- [#323](https://github.com/ogygiajs/ogygia/pull/323) [`7a53a56`](https://github.com/ogygiajs/ogygia/commit/7a53a56105714777cc3282552f52ddffc08e5414) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A publish's thaw notices go through an outbox handed to the request's `waitUntil` (the new `app.keepAlive`), so a serverless instance that freezes after the response no longer loses them and peers no longer keep stale pages until their TTL ([#286](https://github.com/ogygiajs/ogygia/issues/286)).

- [#321](https://github.com/ogygiajs/ogygia/pull/321) [`17e009a`](https://github.com/ogygiajs/ogygia/commit/17e009ad985e6cda5ca371cd46e65f003c387471) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A peer whose store fails to apply a thaw notice now answers an error, so the sender sends it again, instead of answering done and deduping the retry; `app.notify` rejects once every hook ran when one failed ([#287](https://github.com/ogygiajs/ogygia/issues/287)).

- [#384](https://github.com/ogygiajs/ogygia/pull/384) [`4da8fe4`](https://github.com/ogygiajs/ogygia/commit/4da8fe43af2706401bd54d9f46f87dc15e385960) Thanks [@PuruVJ](https://github.com/PuruVJ)! - In Safari an island file whose download failed is asked for again under a fresh URL, as in the other browsers, and its failure is reported as a failed load, not a failed hydration ([#383](https://github.com/ogygiajs/ogygia/issues/383)).

- [#254](https://github.com/ogygiajs/ogygia/pull/254) [`346c692`](https://github.com/ogygiajs/ogygia/commit/346c6926d79a594596263791de6a811578f9f0e1) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A transportable class whose module fails to download is asked for again: the next island that carries it loads it under a fresh URL and decodes it, instead of every later island decoding without the class until a reload ([#237](https://github.com/ogygiajs/ogygia/issues/237)).
- Updated dependencies [[`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`34fcfc8`](https://github.com/ogygiajs/ogygia/commit/34fcfc807ebc87dbcaeac073c78e66a302ae6461), [`c781aeb`](https://github.com/ogygiajs/ogygia/commit/c781aeb6e06d6416a4c930dc02e7199fea3eaee0), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`11c5f0d`](https://github.com/ogygiajs/ogygia/commit/11c5f0d0d67f5c9149ba4643d979e4bdbfd3d36a), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`b4113bf`](https://github.com/ogygiajs/ogygia/commit/b4113bf3233d2024442e8dd30bc78c0c35ac0f38), [`11c5f0d`](https://github.com/ogygiajs/ogygia/commit/11c5f0d0d67f5c9149ba4643d979e4bdbfd3d36a), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`0d22e3e`](https://github.com/ogygiajs/ogygia/commit/0d22e3e5c942f42880bfa5d91fcb6959d3a1aae2), [`7a53a56`](https://github.com/ogygiajs/ogygia/commit/7a53a56105714777cc3282552f52ddffc08e5414), [`9cd69de`](https://github.com/ogygiajs/ogygia/commit/9cd69de1358147259cfb79a62eac00359b03bd00), [`b4113bf`](https://github.com/ogygiajs/ogygia/commit/b4113bf3233d2024442e8dd30bc78c0c35ac0f38), [`7b35e33`](https://github.com/ogygiajs/ogygia/commit/7b35e332fe548cf08cc9f0607496c81eda7dc519), [`79aa5b3`](https://github.com/ogygiajs/ogygia/commit/79aa5b3d8070c393627255fb2b4c259788d9e545), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4), [`11c5f0d`](https://github.com/ogygiajs/ogygia/commit/11c5f0d0d67f5c9149ba4643d979e4bdbfd3d36a), [`cc047cc`](https://github.com/ogygiajs/ogygia/commit/cc047ccbe9dffe6d2e0c8bc7375a90cf305300e4), [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4)]:
  - @ogygia/machine@0.13.0

## 0.12.3

### Patch Changes

- [#166](https://github.com/ogygiajs/ogygia/pull/166) [`a2eade9`](https://github.com/ogygiajs/ogygia/commit/a2eade9cebe01c844d8ba3106945acadf05b10a8) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A component a markdown page imports is styled on a csr=false page: its scoped CSS (and any style file it imports) now ships in the page's content stylesheet beside the page's own `<style>`.

## 0.12.2

### Patch Changes

- [#164](https://github.com/ogygiajs/ogygia/pull/164) [`2a4dc9c`](https://github.com/ogygiajs/ogygia/commit/2a4dc9c9d83adf14c56b1ae714a7044088b7b8ff) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `ogygia.extensions()` and `ogygia.preprocess()` from `ogygia/vite` are callable again and do nothing (`['.svelte']` and `[]`), so a svelte config written for 0.8 loads; the markdown ones come from `@ogygia/content/vite`.

## 0.12.1

### Patch Changes

- [#162](https://github.com/ogygiajs/ogygia/pull/162) [`0f2f6d6`](https://github.com/ogygiajs/ogygia/commit/0f2f6d679562cfc1774c645a8a31a06e17070b76) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A `render: 'deferred'` hole timed with `wake` builds again: `wake` times it as `fetch` does, and the build warns with the `fetch` to write.

## 0.12.0

### Minor Changes

- [#157](https://github.com/ogygiajs/ogygia/pull/157) [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An island loaded without a `src` (a region the browser renders, a held or live region from a remote function or a stream, a hole rebuilt after a failed hydration, a portable snippet with no island graph) loads its content-hashed file: the build writes its locations into one content-hashed map, which the runtime's script names and the first such load reads.

- [#157](https://github.com/ogygiajs/ogygia/pull/157) [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A client-side navigation into a page of another build (a deploy since the page was loaded) loads that page as a document instead of swapping it into the running runtime, so two builds' islands, runtimes and Svelte never meet on one page.

- [#157](https://github.com/ogygiajs/ogygia/pull/157) [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Every file a build writes under `<appDir>/immutable/` is now named by its content, so a host's year-long rule for that directory can never serve another build's code: the stable-name files (`og-region.<id>.js`, `og-runtime.<id>.js`), whose content changed every build, are gone. An island's `entry` is now a name, not a file. The one file at a fixed name is `<appDir>/ogygia.json`, beside Kit's `version.json`: the current build's locations, which a page that outlived its build reads to wake its islands on the current code. Serve it as you serve `version.json` (revalidated); a federated app also needs the same `Access-Control-Allow-Origin` on it as on its `immutable/` files. A page cached from before content hashing, which loaded the runtime by its stable name, no longer recovers.

### Patch Changes

- [#151](https://github.com/ogygiajs/ogygia/pull/151) [`64f6046`](https://github.com/ogygiajs/ogygia/commit/64f6046512f0cea076b2094d16ed75d4e1c726d3) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A client-side navigation no longer removes nodes the page's own code put in `<body>` (a popover portal's anchor, a toast host), so a popover in an island the navigation keeps still opens afterwards; only the server's body children and attributes are replaced.

- [`75a5cdd`](https://github.com/ogygiajs/ogygia/commit/75a5cdd66de1b96f45585119b03f2ba4fc7a03ec) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `handle({ secret })` signs region capabilities with a secret the app passes (e.g. from `$env/static/private`), for a server that never sees `OGYGIA_SECRET` at runtime; it signs exactly as the same `OGYGIA_SECRET` does, and every copy of ogygia in the process uses it.

## 0.11.5

### Patch Changes

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An app with no deferred, live or lake region no longer ships the region element's fetch, apply and morph code.

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An island page no longer downloads runtime code for features its app does not use.

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A `+page.md` route counts as a page like `+page.svelte`, so a csr=false markdown page no longer makes every island page ship extra Svelte and runtime code.

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An app whose islands never read their page no longer ships the page seed runtime or the MPA navigation handle.

## 0.11.4

### Patch Changes

- [#130](https://github.com/ogygiajs/ogygia/pull/130) [`fede66a`](https://github.com/ogygiajs/ogygia/commit/fede66ae685497399a257cb2a498516364e8064b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The hook types type-check on SvelteKit 3 too: `Handle` is the library's own (Kit 3 moved Kit's to `@sveltejs/kit/hooks`), so a Kit 3 app no longer sees an untyped `handle` from ogygia, devtools or postrender.

## 0.11.3

### Patch Changes

- [#118](https://github.com/ogygiajs/ogygia/pull/118) [`acce10a`](https://github.com/ogygiajs/ogygia/commit/acce10a8eeebae3abc5289de577a302666bec8a5) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A web component around a hole is restored like one around an island, so its own runtime no longer adopts it and moves the hole it holds.

## 0.11.2

### Patch Changes

- [#107](https://github.com/ogygiajs/ogygia/pull/107) [`a83fe25`](https://github.com/ogygiajs/ogygia/commit/a83fe2574bab6e098d292e4486fc5dea9e32bca5) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The drop-in `setContext` now reaches islands inside a lake on a csr=true page; a csr=true page with no island ogygia wakes still ships no context.

## 0.11.1

### Patch Changes

- [#95](https://github.com/ogygiajs/ogygia/pull/95) [`0eced1d`](https://github.com/ogygiajs/ogygia/commit/0eced1d4dc1bd1e5c3507bea40d6aab308099c2a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The "uses ogygia marks, but its package declares no ogygia.files" warning fires only for a real marked import, not for a dependency whose comments, strings or error messages merely mention `with { wake }` (the plugin packages tripped it).

## 0.11.0

### Patch Changes

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Remote deferred holes now share local holes' lifetime and renewal: they were signed for a fixed 5 minutes and answered 410 after, so a stored or cached page older than that showed dead remote regions. Plugins sign with core's rule through `app.capability`.

## 0.0.0

Initialize package.
