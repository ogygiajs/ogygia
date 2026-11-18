<script lang="ts">
	// Template elements beside an `{@html}` with content and one with none. The server renders
	// HtmlBesideServer.svelte, this file as the compiler stamps it; the browser hydrates this file.
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
