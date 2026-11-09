<script lang="ts">
	// ROUTER LINKS (e2e/router-document-fetch.spec.ts): the SPA router must land where a real browser
	// navigation would. A link to a path another application serves behind the same origin (the test
	// fakes that server), a web-component link that re-dispatches the visitor's click on its inner
	// `<a>` (the element is defined by the test), the same with its anchor in its shadow root, a link
	// to a csr=true Kit page (e2e/mixed.spec.ts: back from it), a plain link with a hover preload, and
	// three links the browser never replaces the page for: a file download, a 204, and a download
	// sent as HTML.
</script>

<h1 data-router-links>Router links</h1>

<p><a href="/router-links/foreign/docs/" data-foreign>foreign page</a></p>
<p><x-relink><a href="/about" data-relink>about (web-component link)</a></x-relink></p>
<p><x-shadow-relink href="/about" data-shadow-relink></x-shadow-relink></p>
<p><a href="/kit" data-kit-link>the Kit page (csr=true)</a></p>
<p><a href="/about" data-plain data-sveltekit-preload-data="hover">about</a></p>
<p><a href="/router-links/export.csv" data-download>export (a file download)</a></p>
<p><a href="/router-links/no-content" data-no-content>no content (a 204)</a></p>
<p><a href="/router-links/export.html" data-download-html>report (a download sent as HTML)</a></p>
