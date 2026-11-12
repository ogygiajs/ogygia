<script lang="ts">
	// The shell's own server island (so the shell's runtime fetches holes at all).
	let { who = 'stranger' }: { who?: string } = $props();
</script>

<p data-testid="shell-later">later, {who}</p>
