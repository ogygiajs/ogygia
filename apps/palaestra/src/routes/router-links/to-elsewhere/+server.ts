// A real redirect to the non-ogygia document beside it (e2e/router-document-fetch): the server a
// spec sends the router's fetch to when that server keys a redirect on the fetch's own header.
// (A redirect from the server, not a route's: Playwright's WebKit cannot fulfill a 3xx.)
export const GET = () =>
	new Response(null, { status: 302, headers: { location: '/router-links/elsewhere' } });
