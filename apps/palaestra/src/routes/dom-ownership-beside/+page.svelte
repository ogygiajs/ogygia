<script lang="ts">
	// DOM OWNERSHIP beside an `{@html}` (e2e/dom-ownership.spec.ts): after the runtime booted (so the
	// island's server copy is pristine) and before the island wakes (interaction), a third party puts
	// a node first in the walked `<p>`, one after the `{@html}` content, and one inside it.
	import Beside from '$lib/ownership/Beside.svelte' with { wake: 'interaction' };

	// (the closing tag is split so it does not end this component's own <script> block)
	const third_party = `<script>addEventListener("load",()=>setTimeout(()=>{const b=document.querySelector(".beside");const p=b.querySelector(".walked");p.prepend(Object.assign(document.createElement("i"),{className:"tp-walked"}));b.querySelector(".after").before(Object.assign(document.createElement("i"),{className:"tp-outside"}));b.querySelector(".note").append(Object.assign(document.createElement("i"),{className:"tp-content"}));document.documentElement.setAttribute("data-tp-done","")},50));\x3C/script>`;
</script>

<svelte:head>{@html third_party}</svelte:head>

<h1 data-static-shell>dom ownership — a third party edits beside an {'{@html}'}</h1>

<Beside />
