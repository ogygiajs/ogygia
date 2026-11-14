<script lang="ts">
	import Provide from '../../../src/Provide.svelte';
	import ContextText from './ContextText.svelte';

	let values = $state({ probe: 'first' });
	export const swap = (probe: string): void => {
		values = { probe };
	};
</script>

<Provide {values}><ContextText /></Provide>
