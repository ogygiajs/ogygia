<script lang="ts">
	import { greet } from '$lib/greet.remote';
</script>

<p data-greeting>{await greet('kit')}</p>
