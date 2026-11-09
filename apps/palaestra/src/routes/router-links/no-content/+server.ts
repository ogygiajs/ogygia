// No content (e2e/router-document-fetch, #266): a navigation to a 204 leaves the page on screen, so
// the router's hand-off of it is a navigation that never replaces the page.
export const GET = () => new Response(null, { status: 204 });
