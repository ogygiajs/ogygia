<script lang="ts">
	let { label = 'shared' }: { label?: string } = $props();
</script>

<span class="sharedprobe" data-content-css-shared>{label}</span>

<style>
	/* The layout renders this component, so its CSS ships with the layout's client chunk; a content
	   body importing it too must not copy that CSS into the body's own asset. */
	.sharedprobe {
		outline: 4px solid rgb(37, 99, 235);
	}
</style>
