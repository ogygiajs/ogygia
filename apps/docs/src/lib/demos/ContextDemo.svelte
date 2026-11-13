<script lang="ts">
	import CtxCount from './CtxCount.svelte' with { wake: 'load' };
	import CtxAdd from './CtxAdd.svelte' with { wake: 'load' };
	import { Cart, setCart } from './cart-store.svelte.ts';

	// One live cart, set once. Neither island below receives it as a prop —
	// they call getCart() and reach this same instance across the island boundary.
	setCart(new Cart());
</script>

<div class="ctx-demo-row">
	<div class="ctx-demo"><CtxCount /></div>
	<div class="ctx-demo"><CtxAdd /></div>
</div>

<style>
	.ctx-demo-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 1rem;
		margin: 1.5rem 0;
	}
	.ctx-demo {
		padding: 1.25rem;
		border: 1px solid var(--line);
		border-radius: var(--r-md, 12px);
		background: var(--bg-sunken);
	}
</style>
