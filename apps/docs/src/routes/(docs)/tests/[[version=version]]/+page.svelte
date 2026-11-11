<script lang="ts">
	import PageHead from '$lib/PageHead.svelte';
	import VersionPicker from '$lib/tests/VersionPicker.svelte';
	import RatioNote from '$lib/tests/RatioNote.svelte';
	import { KINDS, count, percent, slug_of } from '$lib/tests/data';
	import '$lib/tests/tests.css';

	let { data } = $props();
	const s = $derived(data.summary);
	const t = $derived(s.totals);
	const engines = $derived(
		(s.engines ?? (['chromium', 'firefox', 'webkit'] as const)).map((id) => {
			const r = t.byEngine[id];
			return {
				id,
				label: { chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit' }[id],
				...r,
				total: r.pass + r.fail + r.skip
			};
		})
	);
	const packages = $derived(Object.entries(s.packages).sort(([a], [b]) => a.localeCompare(b)));
	const failing = $derived(packages.reduce((n, [, p]) => n + p.fail, 0));
	const share = (n: number, total: number) => (total ? (n / total) * 100 : 0);
	const ratio = (test: number, src: number) => (src ? (test / src).toFixed(2) : '–');
	const day = $derived(s.date.slice(0, 10));
</script>

<PageHead
	title="Tests"
	description="How ogygia is tested: every test in every release, by kind, by browser engine and by package."
	category="Tests"
/>

<main class="shell tests">
	<p class="eyebrow">Tests</p>
	<h1>How ogygia is tested</h1>
	<p class="lede">
		Every number here comes from the CI run that built ogygia {s.version}. Tests run in real
		browsers against real builds, and every bug fix starts with a test that failed first.
	</p>
	<div class="run">
		<VersionPicker versions={data.versions} current={s.version} />
		<span
			>commit <a href="https://github.com/ogygiajs/ogygia/commit/{s.commit}"
				><code>{s.commit.slice(0, 8)}</code></a
			></span
		>
		<time datetime={s.date}>{day}</time>
	</div>
	{#if s.e2e === false}
		<p class="notice">
			End-to-end suites are not part of this report yet. Their counts start with a later release.
		</p>
	{/if}

	<section class="headline" aria-label="Headline numbers">
		<div class="stat">
			<span class="n">{count(t.tests)}</span>
			<span class="what">tests in this release</span>
		</div>
		<div class="stat">
			<span class="n">{t.ratio.toFixed(2)}×</span>
			<span class="what"
				>lines of test for each line of source ({count(t.testLines)} to {count(t.srcLines)})</span
			>
			<RatioNote definition={t.ratioDefinition} />
		</div>
		<div class="stat">
			<span class="n">{t.coverage.lines.toFixed(1)}%</span>
			<span class="what">of source lines run by the tests</span>
		</div>
	</section>

	<h2 id="kinds">By kind</h2>
	<ul class="stats">
		{#each KINDS as k (k.id)}
			<li>
				<span class="n">{count(t.byKind[k.id] ?? 0)}</span><span class="what">{k.label}</span>
			</li>
		{/each}
		<li>
			<span class="n">{count(t.regression)}</span><span class="what"
				>Regression tests, each citing an issue</span
			>
		</li>
		<li>
			<span class="n">{count(t.seeded)}</span><span class="what">Seeded race simulations</span>
		</li>
		<li><span class="n">{count(t.benches)}</span><span class="what">Step-count benches</span></li>
		<li class:fail={failing > 0}>
			<span class="n">{count(failing)}</span><span class="what">Failing</span>
		</li>
	</ul>

	<h2 id="engines">By browser engine</h2>
	<div class="table-wrap">
		<table>
			<caption>Browser and end-to-end tests, run once in each engine.</caption>
			<thead>
				<tr>
					<th scope="col">Engine</th>
					<th scope="col" class="num">Pass</th>
					<th scope="col" class="num">Fail</th>
					<th scope="col" class="num">Skip</th>
					<th scope="col"><span class="sr-only">Share</span></th>
				</tr>
			</thead>
			<tbody>
				{#each engines as e (e.id)}
					<tr>
						<th scope="row">{e.label}</th>
						<td class="num">{count(e.pass)}</td>
						<td class="num" class:fails={e.fail > 0}>{count(e.fail)}</td>
						<td class="num">{count(e.skip)}</td>
						<td class="cov">
							<span class="split" aria-hidden="true">
								<span class="pass" style:width="{share(e.pass, e.total)}%"></span>
								<span class="fail" style:width="{share(e.fail, e.total)}%"></span>
								<span class="skip" style:width="{share(e.skip, e.total)}%"></span>
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<h2 id="coverage">Coverage</h2>
	<ul class="stats">
		<li><span class="n">{percent(t.coverage.lines)}</span><span class="what">Lines</span></li>
		<li><span class="n">{percent(t.coverage.branches)}</span><span class="what">Branches</span></li>
		<li>
			<span class="n">{percent(t.coverage.functions)}</span><span class="what">Functions</span>
		</li>
		<li>
			<span class="n">{percent(t.coverage.statements)}</span><span class="what">Statements</span>
		</li>
	</ul>

	<h2 id="packages">By package</h2>
	<div class="table-wrap">
		<table>
			<caption>Pick a package to see each of its tests and its result in each engine.</caption>
			<thead>
				<tr>
					<th scope="col">Package</th>
					<th scope="col" class="num">Tests</th>
					<th scope="col" class="num">Lines</th>
					<th scope="col" class="num">Branches</th>
					<th scope="col" class="num">Functions</th>
					<th scope="col" class="num">Statements</th>
					<th scope="col" class="num">Test : source</th>
					<th scope="col" class="num">Failing</th>
				</tr>
			</thead>
			<tbody>
				{#each packages as [name, p] (name)}
					<tr>
						<th scope="row"
							><a href="/tests/{data.pinned ? `${s.version}/` : ''}{slug_of(name)}"
								><code>{name}</code></a
							></th
						>
						<td class="num">{count(p.tests)}</td>
						<td class="num">{percent(p.coverage.lines)}</td>
						<td class="num">{percent(p.coverage.branches)}</td>
						<td class="num">{percent(p.coverage.functions)}</td>
						<td class="num"
							>{p.coverage.statements === undefined ? '–' : percent(p.coverage.statements)}</td
						>
						<td class="num">{ratio(p.testLines, p.srcLines)}</td>
						<td class="num" class:fails={p.fail > 0}>{count(p.fail)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<h2 id="how">How the testing works</h2>
	<div class="how">
		<section>
			<h3>Real browsers, real builds</h3>
			<p>
				Browser tests run in Chromium, Firefox and WebKit through Vitest browser mode. End-to-end
				tests build real fixture apps and drive them with Playwright. Nothing runs against a fake
				DOM when a real one can answer.
			</p>
		</section>
		<section>
			<h3>Races found by seeded simulation</h3>
			<p>
				Code that can race runs under a seeded scheduler that tries many orderings. Each ordering
				that breaks something becomes a test with its seed, so the same race is checked on every
				run.
			</p>
		</section>
		<section>
			<h3>Every bug is proved first</h3>
			<p>
				A fix lands as two commits: first a test that fails on the old code, then the fix. The test
				says the behavior in plain words and cites its issue. Those are the regression tests counted
				above.
			</p>
		</section>
		<section>
			<h3>Rules, not comments</h3>
			<p>
				A sentence like "this must never happen" is written as something that fails out loud: a
				runtime rule checked at the end of every end-to-end test, a type, a lint rule or a test.
				Lint rules have their own tests.
			</p>
		</section>
		<section>
			<h3>Speed is counted, not timed</h3>
			<p>
				Hot paths have benches that count exact steps instead of timing them, so a result does not
				depend on the machine. A new function on a hot path needs a bench.
			</p>
		</section>
		<section>
			<h3>Size has a budget</h3>
			<p>
				The JavaScript a page boots with is measured on every pull request against its base. Growth
				over half a percent has to say why before it can land.
			</p>
		</section>
	</div>
</main>

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
