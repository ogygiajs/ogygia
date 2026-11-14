---
'@ogygia/core': minor
---

In an app without Svelte's async mode, a `<Region of={promise}>` whose promise rejects now sends the error to the nearest `<svelte:boundary>`, as async mode does. Before, the error was an unhandled rejection no boundary could catch. With no boundary, the page still gets the promise's own error as an unhandled rejection; a region that left the page before its promise failed reports nothing.
