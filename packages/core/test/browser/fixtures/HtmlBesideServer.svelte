<script lang="ts">
	// HtmlBeside.svelte as the compiler's server-leg stamp leaves it, written by hand (this package
	// does not run the compiler). The compiler's ownership-stamps test renders both and checks that
	// they write the same HTML.
	let { note = '<em class="note">cms</em>', empty = '' }: { note?: string; empty?: string } =
		$props();
	let clicks = $state(0);
</script>

<div data-og-html class="beside">
	<p class="walked"><b>count</b> <button onclick={() => (clicks += 1)}>clicks {clicks}</button></p>
	{@html note ? '<!--@html-->' + note : ''}
	<span class="mid">mid</span>
	{@html empty ? '<!--@html-->' + empty : ''}
	<span class="after">after</span>
</div>
