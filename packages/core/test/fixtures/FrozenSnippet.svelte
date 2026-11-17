<script module>
	const n = 3;
	const href = 'a?x=1&y="2"<z>';
	const flag = true;
	export { rich };
</script>

{#snippet rich()}<p class="a b" data-x={href}>
		a > b &amp; c&nbsp;d <br /> <input disabled value="v" />
		{n} it's "q"{#if flag}<i>y</i>{:else}<i>n</i>{/if}{#each [1, 2] as k}<b>{k}</b>{/each}
	</p>{/snippet}
