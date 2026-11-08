// An island entry that takes a while to load and then fails (a module whose code throws as it
// runs): a test can act while it loads, and see what its failure touches.
await new Promise((resolve) => setTimeout(resolve, 400));
throw new Error('slow-fail-entry: this module fails as it loads');

// (a module: its top-level await needs one, and it exports nothing it ever gets to)
export {};
