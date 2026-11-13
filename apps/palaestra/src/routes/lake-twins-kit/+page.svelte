<script lang="ts">
	import TwinLake from '$lib/TwinLake.svelte' with { wake: 'none' };
	const X_TWIN = `<script>
customElements.define('x-twin', class extends HTMLElement {
	connectedCallback() {
		if (this.__rendered) return;
		this.__rendered = true;
		const box = document.createElement('div');
		while (this.firstChild) box.appendChild(this.firstChild);
		this.append(box);
	}
});
${'<'}/script>`;
	let n = $state(0);
</script>

<svelte:head>
	<title>twin lakes on a csr=true page Kit remounts</title>
	<!-- svelte-ignore hydration_html_changed -->
	{@html X_TWIN}
</svelte:head>

<TwinLake tag="header" />
<main>
	<x-twin><p data-twin-widget>a web component that edits its light DOM ({n})</p></x-twin>
	<button data-kit-btn onclick={() => n++}>kit:{n}</button>
</main>
<TwinLake tag="footer" visible />
