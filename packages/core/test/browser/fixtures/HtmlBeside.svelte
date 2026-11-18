<script lang="ts">
	// Template elements beside an `{@html}` with content and one with none. setup.ts server-renders
	// this file through the compiler's server-leg stamp; the browser test hydrates it as it is.
	let { note = '<em class="note">cms</em>', empty = '' }: { note?: string; empty?: string } =
		$props();
	let clicks = $state(0);
</script>

<div class="beside">
	<p class="walked"><b>count</b> <button onclick={() => (clicks += 1)}>clicks {clicks}</button></p>
	{@html note}
	<span class="mid">mid</span>
	{@html empty}
	<span class="after">after</span>
</div>
