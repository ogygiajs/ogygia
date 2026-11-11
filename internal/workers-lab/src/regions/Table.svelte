<script lang="ts">
	import type { Row } from '../data.ts';

	let { title, rows }: { title: string; rows: Row[] } = $props();

	const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });
	const money = new Map<string, Intl.NumberFormat>();
	function format(amount: number, currency: string): string {
		let f = money.get(currency);
		if (f === undefined) {
			f = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
			money.set(currency, f);
		}
		return f.format(amount);
	}
	const total = $derived(rows.reduce((sum, r) => sum + r.amount, 0));
	const late = $derived(rows.filter((r) => r.status === 'late').length);
</script>

<section class="table">
	<h2>{title}</h2>
	<p>{rows.length} orders, {late} late, {format(total, 'EUR')} in all</p>
	<table>
		<thead>
			<tr>
				<th>#</th><th>Customer</th><th>Region</th><th>Placed</th><th>Items</th><th>Amount</th><th
					>Status</th
				>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.id)}
				<tr class:late={row.status === 'late'} data-id={row.id}>
					<td>{row.id}</td>
					<td><a href="/customers/{row.id % 97}">{row.name}</a></td>
					<td>{row.region}</td>
					<td><time datetime={row.placed}>{day.format(new Date(row.placed))}</time></td>
					<td>{row.items}</td>
					<td class="num">{format(row.amount, row.currency)}</td>
					<td><span class="badge {row.status}">{row.status}</span></td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>
