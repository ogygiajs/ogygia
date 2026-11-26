<script lang="ts">
	import Chip from './Chip.svelte';

	let {
		title,
		section = '',
		photo = ''
	}: { title: string; section?: string; photo?: string } = $props();
</script>

<div class="card">
	{#if section}<Chip label={section} />{/if}
	{#if photo}<img src={photo} alt="" style="width: 160px; height: 80px" />{/if}
	<div class="title">{title}</div>
	<div class="foot">example.com</div>
</div>

<style>
	.card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: space-between;
		width: 1200px;
		height: 630px;
		padding: 64px;
		background: #102a43;
		font-family: 'JetBrains Mono';
	}
	.title {
		display: flex;
		font-size: 72px;
		font-weight: 500;
		color: #f0f4f8;
	}
	.foot {
		display: flex;
		font-size: 28px;
		color: #9fb3c8;
	}
</style>
