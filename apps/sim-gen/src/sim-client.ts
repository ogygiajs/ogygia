// The simulator's ear in its generated app: a repair that names an ownership conflict says so on the
// page's console, where the page-errors oracle hears it. Nothing in a generated app changes the
// children of an element that owns some of its own (a `<details>`; no web component), so a conflict
// named here is a false one (mutation: the repair's `align_to` saying a level that lined up failed).
import { defineClient } from 'ogygia/plugin/client';

export default defineClient({
	hooks: {
		regionMismatched(e) {
			if (e.kind === 'conflict') console.error(`ownership conflict named: ${e.reason ?? ''}`);
		}
	}
});
