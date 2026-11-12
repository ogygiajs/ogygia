/// <reference types="ogygia/types" />
/// <reference types="@ogygia/content/types" />

// Each release tag's date (`<package>@<version>` → `YYYY-MM-DD`), read from git at build (vite.config.ts).
declare module 'virtual:release-dates' {
	const dates: Record<string, string>;
	export default dates;
}
