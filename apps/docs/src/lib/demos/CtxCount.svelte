<script lang="ts">
	import '$lib/styles/widget.css';
	import { getCart } from './cart-store.svelte.ts';

	// No prop — the cart comes from the setCart() above, across the island boundary.
	const cart = getCart();
</script>

<div class="widget" data-ctx-count>
	<span class="widget-label">Count island</span>
	<div class="widget-row">
		<span class="widget-value" data-ctx-count-value>{cart?.count ?? 0}</span>
		<span class="widget-meta">read from context, no prop</span>
	</div>
</div>
