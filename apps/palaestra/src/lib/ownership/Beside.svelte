<script lang="ts">
	// e2e/dom-ownership: a template element beside an `{@html}` in one parent. Svelte's hydration
	// walks the `<p>` and never enters the `{@html}` content; a third party edits both while the
	// island sleeps, and the wake must put the `<p>` back and leave the content alone.
	const note = '<em class="note">from the CMS</em><span class="tail">tail</span>';
	let clicks = $state(0);
</script>

<div class="beside">
	<p class="walked">
		<b>count</b> <button data-beside-wake onclick={() => (clicks += 1)}>clicks {clicks}</button>
	</p>
	{@html note}
	<span class="after">after</span>
</div>
