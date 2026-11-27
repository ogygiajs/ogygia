<script lang="ts">
	let { title }: { title: string } = $props();
	const avatar = import.meta.og.image('../images/avatar.jpg');
</script>

<div class="card">
	<img class="avatar" src={avatar.src} alt="" />
	<div class="mark"></div>
	<div class="title">{title}</div>
</div>

<style>
	.card {
		display: flex;
		width: 1200px;
		height: 630px;
		background: #102a43;
		font-family: 'JetBrains Mono';
	}
	.avatar {
		width: 200px;
		height: 200px;
	}
	.mark {
		display: flex;
		width: 300px;
		height: 300px;
		background-image: url(http://127.0.0.1:4176/photos/mark.webp);
	}
	.title {
		display: flex;
		font-size: 48px;
		color: #f0f4f8;
	}
</style>
