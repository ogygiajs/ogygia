// A download sent as HTML (e2e/router-document-fetch, #297): `Content-Disposition: attachment` makes
// it a file to save whatever its type, so the router hands it to the browser, which saves it. It
// carries the router's marker, as a report rendered by the app's own layout would.
export const GET = () =>
	new Response(
		`<!doctype html><html><head><meta name="ogygia-router"><title>report</title></head><body><h1 data-report>report</h1></body></html>`,
		{
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'content-disposition': 'attachment; filename="report.html"'
			}
		}
	);
