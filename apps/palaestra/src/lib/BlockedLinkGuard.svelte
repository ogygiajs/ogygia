<script lang="ts">
	// A nav guard (e2e/router-ownership.spec.ts): cancels every navigation to /soft-race/blocked, and
	// counts how often it ran.
	import { beforeNavigate } from '$app/navigation';

	let cancelled = $state(0);
	beforeNavigate((nav) => {
		if (nav.to?.url.pathname !== '/soft-race/blocked') return;
		nav.cancel();
		cancelled++;
	});
</script>

<span data-guard-cancelled={cancelled} hidden></span>
