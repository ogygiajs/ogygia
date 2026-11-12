<script lang="ts">
	import PageHead from '$lib/PageHead.svelte';
	import VersionPicker from '$lib/tests/VersionPicker.svelte';
	import RatioNote from '$lib/tests/RatioNote.svelte';
	import TestFilter from '$lib/tests/TestFilter.svelte' with { wake: 'load' };
	import {
		ENGINES,
		KINDS,
		count,
		percent,
		issue_href,
		issue_label,
		type Engine,
		type Row
	} from '$lib/tests/data';
	import '$lib/tests/tests.css';

	let { data } = $props();
	const p = $derived(data.pkg);
	const kind_label = (id: string) => KINDS.find((k) => k.id === id)?.label ?? id;
	const failed_in = (t: Row) => ENGINES.filter((e) => t.results[e.id] === 'fail').map((e) => e.id);
	const failures = $derived(data.rows.filter((t) => failed_in(t).length > 0));
	const by_file = $derived.by(() => {
		const files = new Map<string, Row[]>();
		for (const t of data.rows) {
			const list = files.get(t.file);
			if (list) list.push(t);
			else files.set(t.file, [t]);
		}
		return [...files].sort(([a], [b]) => a.localeCompare(b));
	});
	// Attributes the filter reads, left off when empty to keep a big grid's HTML small.
	const list_of = (ids: string[]) => (ids.length ? ids.join(' ') : undefined);
	const engine_label = (id: Engine) => ENGINES.find((e) => e.id === id)!.label;
	const ratio = $derived(p.srcLines ? (p.testLines / p.srcLines).toFixed(2) : '–');
	const tests_href = $derived(data.pinned ? `/tests/${data.version}` : '/tests');
</script>

<PageHead
	title="{data.name} tests"
	description="Every test of {data.name} {data.version}, its result in each engine, and its coverage."
	category="Tests"
/>

<main class="shell tests">
	<p class="crumb"><a href={tests_href}>Tests</a> / {data.name}</p>
	<h1><code>{data.name}</code></h1>
	<div class="run">
		<VersionPicker versions={data.versions} current={data.version} pkg={data.slug} />
		<span
			>commit <a href="https://github.com/ogygiajs/ogygia/commit/{data.commit}"
				><code>{data.commit.slice(0, 8)}</code></a
			></span
		>
		<time datetime={data.date}>{data.date.slice(0, 10)}</time>
	</div>

	<section class="headline" aria-label="Headline numbers">
		<div class="stat">
			<span class="n">{count(p.tests)}</span>
			<span class="what"
				>test runs ({count(data.rows.length)} tests, each run in Node, the browsers or both)</span
			>
		</div>
		<div class="stat">
			<span class="n">{ratio}×</span>
			<span class="what"
				>lines of test for each line of source ({count(p.testLines)} to {count(p.srcLines)})</span
			>
			<RatioNote definition={data.ratioDefinition} />
		</div>
		<div class="stat">
			<span class="n">{p.coverage.lines.toFixed(1)}%</span>
			<span class="what">of source lines run by the tests</span>
		</div>
	</section>

	<ul class="stats">
		{#each KINDS as k (k.id)}
			<li>
				<span class="n">{count(p.byKind[k.id] ?? 0)}</span><span class="what">{k.label}</span>
			</li>
		{/each}
		<li class:fail={p.fail > 0}>
			<span class="n">{count(p.fail)}</span><span class="what">Failing</span>
		</li>
	</ul>

	<h2 id="coverage">Coverage</h2>
	<ul class="stats">
		<li><span class="n">{percent(p.coverage.lines)}</span><span class="what">Lines</span></li>
		<li><span class="n">{percent(p.coverage.branches)}</span><span class="what">Branches</span></li>
		<li>
			<span class="n">{percent(p.coverage.functions)}</span><span class="what">Functions</span>
		</li>
		{#if p.coverage.statements !== undefined}
			<li>
				<span class="n">{percent(p.coverage.statements)}</span><span class="what">Statements</span>
			</li>
		{/if}
	</ul>

	{#if failures.length}
		<h2 id="failures">Failing</h2>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th scope="col">Test</th>
						<th scope="col">Fails in</th>
						<th scope="col">Issue</th>
					</tr>
				</thead>
				<tbody>
					{#each failures as t, i (i)}
						<tr>
							<td>{t.name}<br /><code class="nil">{t.file}</code></td>
							<td class="fails">{failed_in(t).map(engine_label).join(', ')}</td>
							<td>
								{#if t.issue}<a href={issue_href(t.issue)}>{issue_label(t.issue)}</a>{:else}<span
										class="nil">none yet</span
									>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<h2 id="tests">Every test</h2>
	{#if !data.e2e}
		<p class="note">End-to-end suites are not part of this report yet.</p>
	{/if}
	<TestFilter total={data.rows.length}>
		<div class="table-wrap">
			<table class="grid">
				<thead>
					<tr>
						<th scope="col">Test</th>
						<th scope="col">Kind</th>
						{#each ENGINES as e (e.id)}<th scope="col">{e.label}</th>{/each}
					</tr>
				</thead>
				{#each by_file as [file, list] (file)}
					<tbody data-file={file}>
						<tr class="file"
							><th scope="rowgroup" colspan={2 + ENGINES.length}><code>{file}</code></th></tr
						>
						{#each list as t, i (i)}
							<tr
								data-kind={t.kinds.join(' ')}
								data-run={list_of(ENGINES.filter((e) => t.results[e.id]).map((e) => e.id))}
								data-fail={list_of(failed_in(t))}
							>
								<td
									>{t.name}{#if t.issue}
										<a class="issue" href={issue_href(t.issue)}>{issue_label(t.issue)}</a>{/if}</td
								>
								<td>{t.kinds.map(kind_label).join(', ')}</td>
								{#each ENGINES as e (e.id)}
									{@const r = t.results[e.id]}
									<td
										>{#if r}<span class="res {r}">{r}</span>{:else}<span class="nil">not run</span
											>{/if}</td
									>
								{/each}
							</tr>
						{/each}
					</tbody>
				{/each}
			</table>
		</div>
	</TestFilter>
</main>
