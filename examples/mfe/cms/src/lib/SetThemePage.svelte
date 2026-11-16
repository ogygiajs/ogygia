<script lang="ts">
	import { setTheme } from './theme.ts';
	import SetThemeProbe from './SetThemeProbe.svelte' with { wake: 'load' };
	setTheme('forest');
</script>

<h2 data-testid="cms-set-theme">Theme, set by the page</h2>
<SetThemeProbe />
