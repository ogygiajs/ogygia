<script lang="ts">
	import type { RobustnessView } from './data.ts';

	let { view }: { view: RobustnessView } = $props();
</script>

<h2 id="robustness">Beyond the tests</h2>
<p class="lede">
	Tests check what someone thought to ask. These checks go looking for what nobody thought of:
	random apps, failures made to happen on purpose, and bugs planted to see if they get caught. Every
	number is counted from the code at this commit. Each one links to the file that explains it.
</p>

{#each view.groups as group (group.id)}
	<h3 class="robust-title" id={group.id}>{group.title}</h3>
	<ul class="robust">
		{#each group.tiles as tile (tile.what)}
			<li>
				<span class="n">{tile.n}</span>
				<span class="what">{tile.what}</span>
				<span class="why">{tile.why}</span>
				<a class="src" href={tile.href}><code>{tile.file}</code></a>
			</li>
		{/each}
	</ul>
{/each}

{#if view.comments}
	<details class="robust-more">
		<summary>Comments still to turn into tests, by package</summary>
		<div class="table-wrap">
			<table>
				<caption>
					Counted by <a href={view.commentsHref}><code>internal/checks/comments.ts</code></a> in each
					package's source.
				</caption>
				<thead>
					<tr>
						<th scope="col">Package</th>
						<th scope="col" class="num">Comments left</th>
						<th scope="col">New ones fail the build</th>
					</tr>
				</thead>
				<tbody>
					{#each view.comments as c (c.name)}
						<tr>
							<th scope="row"><code>{c.name}</code></th>
							<td class="num">{c.flagged.toLocaleString('en-US')}</td>
							<td>{c.enforced ? 'yes' : 'not yet'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
{/if}

<h3 class="robust-title" id="suite-engines">Where each suite runs</h3>
<div class="table-wrap">
	<table>
		<caption>
			The engines CI runs each suite in, read from <a href={view.browsersHref}
				><code>.github/scripts/ci-plan.ts</code></a
			>. WebKit is the engine behind Safari.
		</caption>
		<thead>
			<tr>
				<th scope="col">Suite</th>
				{#each view.engines as e (e.id)}
					<th scope="col">{e.label}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each view.suites as s (s.suite)}
				<tr>
					<th scope="row"><code>{s.suite}</code></th>
					{#each s.runs as runs, i (view.engines[i].id)}
						<td
							>{#if runs}<span class="res pass">runs</span>{:else}<span class="nil">–</span
								>{/if}</td
						>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
