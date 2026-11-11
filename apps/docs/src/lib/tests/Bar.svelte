<script lang="ts">
	import { percent } from './data';

	// A coverage figure: the number is the content, the bar only draws it.
	let { value, label }: { value: number; label?: string } = $props();
	const tone = $derived(value >= 90 ? 'high' : value >= 75 ? 'mid' : 'low');
</script>

<span class="bar {tone}">
	<span class="num"
		>{#if label}<span class="sr">{label} </span>{/if}{percent(value)}</span
	>
	<span class="track" aria-hidden="true"
		><span class="fill" style:width="{Math.max(0, Math.min(100, value))}%"></span></span
	>
</span>

<style>
	.bar {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 9rem;
		width: 100%;
	}
	.num {
		flex: none;
		width: 3.4rem;
		text-align: right;
		font: 500 0.8125rem/1 var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.track {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--bg-sunken);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: 3px;
		background: var(--accent);
	}
	.mid .fill {
		background: var(--warn);
	}
	.low .fill {
		background: var(--t-fail, light-dark(#b42318, #f08a7e));
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
