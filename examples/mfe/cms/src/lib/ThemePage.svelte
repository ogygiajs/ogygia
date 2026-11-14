<script lang="ts">
	// A value the cms page hands its island through ogygia's cross-island context: the shell has no
	// context of its own, so a mounted cms page needs the shell's runtime to carry it anyway (#1931).
	import { Provide } from 'ogygia';
	import ThemeProbe from './ThemeProbe.svelte' with { wake: 'load' };
</script>

<h2 data-testid="cms-theme">Theme</h2>
<Provide values={{ 'mfe-cms-theme': 'ocean' }}>
	<ThemeProbe />
</Provide>
