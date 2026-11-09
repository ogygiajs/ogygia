<script lang="ts">
	// An island on /hole-kept/a and /hole-kept/b with the same props: a navigation between them keeps
	// it as it is, so no morph puts its heading's attributes back. The heading is a `#hash` target the
	// navigation focuses (e2e/kept-heading-focus.spec.ts).
	let clicks = $state(0);
</script>

<h2 id="kept-heading" data-kept-heading>kept heading</h2>
<button type="button" data-kept-heading-button onclick={() => clicks++}>clicked {clicks}</button>
