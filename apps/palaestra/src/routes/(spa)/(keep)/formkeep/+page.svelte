<script lang="ts">
	import KeepForm from '$lib/KeepForm.svelte' with { wake: 'load' };
</script>

<h1 data-static-shell>Form keep</h1>
<a href="/cart-a" data-leave>leave</a>
<a href="/formkeep-next" data-next>next form</a>
<KeepForm />
