<script lang="ts">
	// A toggle (`role="switch"`): each click flips it once (e2e/wake-early-click.spec.ts).
	let on = $state(false);
	let flips = $state(0);
</script>

<button
	type="button"
	role="switch"
	aria-checked={on}
	data-wake-switch
	data-flips={flips}
	onclick={() => {
		on = !on;
		flips += 1;
	}}
>
	{on ? 'on' : 'off'}
</button>
