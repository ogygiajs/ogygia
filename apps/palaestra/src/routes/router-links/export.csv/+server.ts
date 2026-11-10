// A file download (e2e/router-document-fetch, #266): the browser saves it and keeps the page on
// screen, so the router's hand-off of it is a navigation that never replaces the page.
import { dedent } from 'ogygia/plugin/utils';
export const GET = () =>
	new Response(
		`${dedent`
		id,name
		1,alpha
		2,beta
	`}\n`,
		{
			headers: {
				'content-type': 'text/csv',
				'content-disposition': 'attachment; filename="export.csv"'
			}
		}
	);
