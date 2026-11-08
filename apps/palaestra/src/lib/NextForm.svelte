<script lang="ts">
	// Another page's island form, shaped like KeepForm where it starts (a text field first): the
	// fields a visitor left on the form page must never be restored into it.
	let note = $state('');
	let agree = $state(false);
</script>

<div class="island" data-next-form>
	<input data-nf-note placeholder="note" bind:value={note} />
	<label><input data-nf-agree type="checkbox" bind:checked={agree} /> agree</label>
	<span data-nf-echo>{note}{agree ? ' ✓' : ''}</span>
</div>
