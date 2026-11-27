<script lang="ts">
	let { label }: { label: string } = $props();
</script>

<span class="chip">{label}</span>

<style>
	.chip {
		display: flex;
		padding: 8px 20px;
		border-radius: 999px;
		background: #f0b429;
		color: #102a43;
		font-size: 24px;
	}
</style>
