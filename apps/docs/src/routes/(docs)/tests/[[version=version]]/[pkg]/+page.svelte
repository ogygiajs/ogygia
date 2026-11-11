<script lang="ts">
	import PageHead from '$lib/PageHead.svelte';
	import Bar from '$lib/tests/Bar.svelte';
	import VersionPicker from '$lib/tests/VersionPicker.svelte';
	import TestFilter from '$lib/tests/TestFilter.svelte' with { wake: 'load' };
	import {
		ENGINES,
		KINDS,
		count,
		issue_href,
		issue_label,
		type Engine,
		type TestCase
	} from '$lib/tests/data';
	import '$lib/tests/tests.css';

	let { data } = $props();
	const p = $derived(data.pkg);
	const tests = $derived(data.report.tests);
	const kind_label = (id: string) => KINDS.find((k) => k.id === id)?.label ?? id;
	const failed_in = (t: TestCase) =>
		ENGINES.filter((e) => t.results[e.id] === 'fail').map((e) => e.id);
	const failures = $derived(tests.filter((t) => failed_in(t).length > 0));
	const by_file = $derived.by(() => {
		const files = new Map<string, TestCase[]>();
		for (const t of tests) {
			const list = files.get(t.file);
			if (list) list.push(t);
			else files.set(t.file, [t]);
		}
		return [...files].sort(([a], [b]) => a.localeCompare(b));
	});
	const coverage = $derived(
		[...data.report.coverage.files].sort((a, b) => a.path.localeCompare(b.path))
	);
	const engine_label = (id: Engine) => ENGINES.find((e) => e.id === id)!.label;
	const ratio = $derived(p.srcLines ? (p.testLines / p.srcLines).toFixed(2) : '–');
	const tests_href = $derived(data.pinned ? `/tests/${data.version}` : '/tests');
</script>

<PageHead
	title="{data.name} tests"
	description="Every test of {data.name} {data.version}, its result in each engine, and the coverage of each file."
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
			<span class="what">tests</span>
		</div>
		<div class="stat">
			<span class="n">{ratio}×</span>
			<span class="what"
				>lines of test for each line of source ({count(p.testLines)} to {count(p.srcLines)})</span
			>
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
					{#each failures as t (t.file + t.name)}
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
	<TestFilter total={tests.length}>
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
						{#each list as t (t.name)}
							<tr
								data-kind={t.kind}
								data-run={ENGINES.filter((e) => t.results[e.id])
									.map((e) => e.id)
									.join(' ')}
								data-fail={failed_in(t).join(' ')}
								data-q={`${t.name} ${t.file}`.toLowerCase()}
							>
								<td class="name">
									{t.name}
									{#if t.issue}<a class="issue" href={issue_href(t.issue)}>{issue_label(t.issue)}</a
										>{/if}
								</td>
								<td class="kind">{kind_label(t.kind)}</td>
								{#each ENGINES as e (e.id)}
									{@const r = t.results[e.id]}
									<td class="engine" data-engine={e.label}>
										{#if r}<span class="res {r}">{r}</span>{:else}<span
												class="nil"
												aria-label="not run">·</span
											>{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				{/each}
			</table>
		</div>
	</TestFilter>

	<h2 id="coverage">Coverage by file</h2>
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">File</th>
					<th scope="col">Lines</th>
					<th scope="col">Branches</th>
					<th scope="col">Functions</th>
				</tr>
			</thead>
			<tbody>
				{#each coverage as f (f.path)}
					<tr>
						<th scope="row"><code>{f.path}</code></th>
						<td class="cov"><Bar value={f.lines} /></td>
						<td class="cov"><Bar value={f.branches} /></td>
						<td class="cov"><Bar value={f.functions} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>

<style>
	.grid .file th {
		padding-top: 0.9rem;
		background: var(--bg-sunken);
		font-weight: 400;
		color: var(--text-dim);
	}
	.grid .name {
		min-width: 16rem;
		line-height: 1.45;
	}
	.grid .kind {
		white-space: nowrap;
		color: var(--text-dim);
		font-size: 0.8125rem;
	}
	.grid [hidden] {
		display: none !important;
	}
	/* On a phone each test is a card: its name, then its kind and a result per engine. */
	@media (max-width: 640px) {
		.grid thead {
			display: none;
		}
		.grid tr[data-kind] {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 0.4rem 0.5rem;
			padding: 0.75rem 1rem;
			border-bottom: 1px solid var(--line);
		}
		.grid tr[data-kind] > td {
			padding: 0;
			border: 0;
		}
		.grid .name,
		.grid .kind {
			grid-column: 1 / -1;
			min-width: 0;
		}
		.grid .engine {
			display: flex;
			flex-direction: column;
			gap: 0.2rem;
		}
		.grid .engine::before {
			content: attr(data-engine);
			font: 400 0.6875rem/1 var(--font-mono);
			color: var(--text-faint);
		}
	}
	.issue {
		margin-left: 0.35rem;
		font: 400 0.75rem/1 var(--font-mono);
		white-space: nowrap;
	}
</style>
