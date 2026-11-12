// What a bundler defines for the rules gate (each file's `RULES`: dev, or a build made with
// `OGYGIA_RULES=1`). Shaped as Vite's own, so the two merge where both are in one program; under
// plain Node `import.meta.env` is undefined, so the gate reads it with `?.`.
interface ImportMetaEnv {
	readonly DEV: boolean;
}
interface ImportMeta {
	readonly env: ImportMetaEnv;
}
declare const __OGYGIA_RULES__: boolean | undefined;
