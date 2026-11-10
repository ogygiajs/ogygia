<script lang="ts">
	/**
	 * The run page body — a `wake:'load'` island. On wake it fires the profile at `<base>/page`, shows a
	 * Windows-style progress bar while the server renders + samples, then swaps to the report (navigates
	 * this document to `/report/<id>`, so an embedding devtools iframe shows the whole thing). For the
	 * `.ogp` path it downloads the encrypted file instead. It also postMessages the final report URL to a
	 * parent frame, so the devtools tab can offer "open in new tab".
	 */
	import { onMount } from 'svelte';
	import { scope, STALE } from '@ogygia/machine';
	import { FakeProgress } from './fake-progress.svelte.ts';
	import { fetch_when_free } from '../busy.ts';
	import { put_report } from './store.ts';

	// ── regexes
	const NON_WORD_G = /\W+/g;

	let {
		base,
		path,
		runs,
		format,
		against = ''
	}: { base: string; path: string; runs: number; format: string; against?: string } = $props();

	const p = new FakeProgress();
	/** The view's own work (its request, the queue's waits): let go when it unmounts. */
	const owner = scope();
	let phase = $state('Starting the profiler…');
	let error = $state('');
	let done_ogp = $state(false);
	let queued = $state(false);
	let waited_s = $state(0);

	/** Fetch /page, waiting while any worker we reach is busy (`fetch_when_free`). Returns the first
	 *  non-409 response, or the last 409 once the wait ran out (the caller surfaces that as an error,
	 *  pointing at Reset); null once the view is gone (the request and the queue end with it). */
	async function fetch_page(url: string): Promise<Response | null> {
		const res = await fetch_when_free(
			owner,
			url,
			{},
			{
				asking: () => {
					queued = false;
					p.start();
					phase = `Rendering ${path} ${runs}× and sampling the server…`;
				},
				busy: (waited) => {
					queued = true;
					waited_s = Math.round(waited / 1000);
					phase = 'In queue — a profile is already running. Waiting for a free worker…';
				}
			}
		);
		return res === STALE ? null : res;
	}

	async function run() {
		try {
			// `keep`: the answer carries the report's dump so THIS BROWSER keeps it (IndexedDB) before
			// navigating — on an ephemeral host the instance that rendered it may be gone by then
			const suffix = format === 'ogp' ? '&format=ogp' : '&format=keep';
			const res = await fetch_page(
				`${base}/page?p=${encodeURIComponent(path)}&runs=${runs}${suffix}`
			);
			if (!res) return;
			if (!res.ok) throw new Error(String(res.status));
			if (format === 'ogp') {
				const blob = await res.blob();
				await p.finish();
				const a = document.createElement('a');
				const href = URL.createObjectURL(blob);
				a.href = href;
				a.download = `profile-${path.replace(NON_WORD_G, '_') || 'page'}.ogp`;
				a.click();
				URL.revokeObjectURL(href);
				done_ogp = true;
				phase = 'Downloaded the encrypted .ogp.';
			} else {
				// /page renders N times and answers { id, url, dump }: keep the dump here, then open the report
				let url = res.url;
				try {
					const keep = (await res.json()) as {
						id?: string;
						url?: string;
						dump?: { meta: { id: string; created: number; trigger: string } };
					};
					if (keep.url) url = keep.url;
					// asked to check a fix: open the new report compared with the one it was run against
					if (against && keep.id) url = `${base}/compare/${against}/${keep.id}`;
					if (keep.dump) {
						phase = 'Keeping the report in this browser…';
						await put_report(keep.dump);
					}
				} catch {
					// ok: an older server 303s to the report instead: res.url is it
				}
				await p.finish();
				phase = 'Opening the report…';
				try {
					window.parent?.postMessage({ type: 'ogygia:profiled', url }, location.origin);
				} catch {
					// ok: no parent, or a cross-origin one: nobody to tell
				}
				location.href = url;
			}
		} catch (e) {
			p.fail();
			queued = false;
			const code = e instanceof Error ? e.message : 'error';
			error = `Profiling failed (${code}). If the page is slow, the host's request timeout may have cut it off — try fewer renders, or tick the .ogp download and open it via Import. If a run got stuck, hit Reset on the dashboard.`;
		}
	}

	onMount(() => {
		void run(); // ok: run shows its own failure (error)
		// unmounted (mid-run or in the queue): its request, its queue's waits and its bar's timers go
		return () => {
			owner.close();
			p[Symbol.dispose]();
		};
	});
</script>

<div class="run">
	<p class="phase">{queued ? '⏳ ' : ''}{phase}</p>
	{#if queued}
		<p class="hint">
			Waited {waited_s}s. Recordings run one at a time per worker (the V8 profiler is process-wide)
			— this keeps polling until one is free, then measures automatically.
		</p>
	{:else}
		<div class="track"><div class="fill" style="width:{p.value}%"></div></div>
		<p class="pct">{Math.round(p.value)}%</p>
	{/if}

	{#if error}
		<p class="verdict">{error}</p>
		<p class="hint"><a href={base}>← back to the dashboard</a></p>
	{:else if done_ogp}
		<p class="hint">
			Your download didn't start? <a href="{base}/view">Open the Import page</a> and pick the file.
		</p>
		<p class="hint"><a href={base}>← back to the dashboard</a></p>
	{/if}
</div>

<style>
	.run {
		max-width: 44rem;
		margin: 2rem 0;
	}
	.phase {
		margin: 0 0 0.6rem;
		font-weight: 600;
	}
	.track {
		height: 12px;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.22);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, #14b8a6, #0ea5e9);
		transition: width 0.24s ease-out;
	}
	.pct {
		margin: 0.4rem 0 0;
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
	}
</style>
