<script lang="ts">
	// Named imports of a barrel, marked as placed islands: one `with` covers every name its import
	// binds, so different schedules go on separate lines. The island entries import the components
	// themselves, straight from the barrel; the host never imports these names.
	import { Ticker as TickerIsland } from '$lib/barrel' with { wake: 'load' };
	import { Flag as FlagIsland } from '$lib/barrel' with { wake: 'visible' };
	// `brandConfig` is a NON-component barrel export used normally in the shell: a plain import.
	import { brandConfig } from '$lib/barrel';
</script>

<h1 data-static-shell>Named regions — barrel islands</h1>
<p data-static-shell data-brand>Brand: {brandConfig.name}</p>

<TickerIsland start={10} label="Barrel ticker" />
<FlagIsland on={true} />
