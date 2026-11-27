import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { dedent } from "@ogygia/core/plugin/utils";

const FIXTURE = fileURLToPath(new URL("../e2e/app", import.meta.url));
const COPIED: readonly string[] = [
  "src",
  "package.json",
  "svelte.config.js",
  "vite.config.ts",
  "tsconfig.json",
];
const BUILD_MS = 180_000;
const PNG_ONE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const PNG_TWO =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC";
const SECRET = "cold-warm-build-secret-0123456789abcdef";
const ISLAND_SIDE_FIRST_CONFIG = "vite.island-side-first.config.ts";

let app = "";

function link_modules(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (name.startsWith(".")) continue;
    const entry = path.join(from, name);
    if (name.startsWith("@")) link_modules(entry, path.join(to, name));
    else fs.symlinkSync(fs.realpathSync(entry), path.join(to, name));
  }
}

beforeAll(() => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), "og-content-cold-warm-"));
  for (const name of COPIED)
    fs.cpSync(path.join(FIXTURE, name), path.join(app, name), {
      recursive: true,
    });
  link_modules(
    path.join(FIXTURE, "node_modules"),
    path.join(app, "node_modules"),
  );
  const page = path.join(app, "src", "routes", "cold-warm-assets");
  fs.mkdirSync(page, { recursive: true });
  for (const [name, bytes] of [
    ["one.png", PNG_ONE],
    ["two.png", PNG_TWO],
  ] as const)
    fs.writeFileSync(path.join(page, name), Buffer.from(bytes, "base64"));
  fs.writeFileSync(
    path.join(page, "+page.svelte"),
    dedent`
			<script>
				import one from './one.png?no-inline';
				import two from './two.png?no-inline';
			</script>

			<img src={one} alt="one" /><img src={two} alt="two" />
		`,
  );
  fs.writeFileSync(
    path.join(app, ISLAND_SIDE_FIRST_CONFIG),
    dedent`
			import { sveltekit } from '@sveltejs/kit/vite';
			import { ogygia } from 'ogygia/vite';
			import { content } from '@ogygia/content/vite';
			import { defineConfig } from 'vite';

			const REGION = '/core/dist/Region.svelte';
			const INTERNAL = '/core/dist/internal.js';
			let heard = () => {};
			const island_side = new Promise((resolve) => (heard = resolve));
			const settled = island_side.then(() => new Promise((resolve) => setTimeout(resolve, 200)));
			const hold = {
				name: 'hold-region-until-island-side',
				enforce: 'pre',
				resolveId(source, importer) {
					if (source === './Region.svelte' && importer?.endsWith(INTERNAL)) heard();
					return null;
				},
				async load(id) {
					if (id.endsWith(REGION))
						await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 3000))]);
					return null;
				}
			};

			export default defineConfig({
				plugins: [hold, ogygia(), content({ markdown: {} }), sveltekit()]
			});
		`,
  );
});

afterAll(() => {
  if (app) fs.rmSync(app, { recursive: true, force: true });
});

function build(config?: string): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OGYGIA_SECRET: SECRET,
    CONTENT_E2E_KIT_VERSION: "cold-warm",
  };
  delete env.OGYGIA_E2E_OUT_DIR;
  const args = [
    "node_modules/vite/bin/vite.js",
    "build",
    ...(config ? ["--config", config] : []),
  ];
  const res = spawnSync("node", args, {
    cwd: app,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0)
    throw new Error(
      `the fixture's build failed:\n${`${res.stdout}${res.stderr}`.slice(-4000)}`,
    );
}

const BUILD_KEY_RE = /(\bbuild_key\s*=\s*)"[0-9a-f]{64}"/g;

function files(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .sort()) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isFile())
      out.set(name, fs.readFileSync(abs, "latin1"));
  }
  return out;
}

function keyed(built: Map<string, string>): {
  keys: string[];
  files: Map<string, string>;
} {
  const keys: string[] = [];
  const out = new Map<string, string>();
  for (const [name, text] of built)
    out.set(
      name,
      text.replace(BUILD_KEY_RE, (whole: string, head: string) => {
        keys.push(whole.slice(head.length));
        return `${head}"<build key>"`;
      }),
    );
  return { keys, files: out };
}

function markup_entries(): Map<string, string> {
  const dir = path.join(app, "node_modules", ".ogygia", "markup");
  const out = new Map<string, string>();
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const stat = fs.statSync(path.join(dir, name));
    out.set(name, `${stat.ino}:${stat.mtimeMs}`);
  }
  return out;
}

test(
  "a warm build (the build cache kept) writes the same output, byte for byte, as a cold build of the same source, but for each build's own random key",
  () => {
    const output = path.join(app, ".svelte-kit", "output");
    build();
    const cold = keyed(files(output));
    const cached = markup_entries();
    build();
    const warm = keyed(files(output));

    expect(cached.size).toBeGreaterThan(0);
    expect(markup_entries()).toEqual(cached);
    expect(
      [...cold.files.keys()].filter((name) => name.endsWith(".png")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(cold.keys).toHaveLength(1);
    expect(warm.keys).toHaveLength(1);
    expect(warm.keys[0]).not.toBe(cold.keys[0]);
    expect(
      [...cold.files.keys()].some((name) =>
        name.startsWith(`server${path.sep}`),
      ),
    ).toBe(true);
    expect([...warm.files.keys()]).toEqual([...cold.files.keys()]);
    const differ = [...cold.files]
      .filter(([name, text]) => warm.files.get(name) !== text)
      .map(([n]) => n);
    expect(differ).toEqual([]);
  },
  BUILD_MS * 2,
);

test(
  "a build writes the same output whichever importer of a shared package module the bundler reaches first: a page's, or an island's (#2184)",
  () => {
    const output = path.join(app, ".svelte-kit", "output");
    build();
    const page_side_first = keyed(files(output)).files;
    build(ISLAND_SIDE_FIRST_CONFIG);
    const island_side_first = keyed(files(output)).files;

    const client = (built: Map<string, string>) =>
      [...built.keys()].filter((name) => name.startsWith(`client${path.sep}`));
    expect(client(island_side_first)).toEqual(client(page_side_first));
    const differ = [...page_side_first]
      .filter(([name, text]) => island_side_first.get(name) !== text)
      .map(([n]) => n);
    expect(differ).toEqual([]);
  },
  BUILD_MS * 2,
);
