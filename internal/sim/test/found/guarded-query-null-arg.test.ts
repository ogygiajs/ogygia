// FOUND BY THE SIMULATOR (palaestra, seed 2, shrunk to 3 actions): on /boundary, pressing "Search B"
// twice 300 ms apart sends a THIRD boxSearch with the argument `null` (payload `[null]`). The
// server refuses it (400), and the rejection is unhandled. The page guards the call with
// `{#if qb}<Region of={boxSearch(qb)}>`, so `qb` is never null where it runs.
//
// The cause is Svelte's async mode, not ogygia or Kit: with two overlapping updates, the guarded
// branch's prop expression runs again with the value from before the first update, and the
// child's `await of` awaits it (a plain Svelte component with a lazy thenable does the same, with
// no Kit and no ogygia: the issue has it). The rejection is unhandled because no boundary is
// around the await. (Skipped without the app built for the simulator.)
//
//   1. tab 0: click link #935
//   2. new tab at /boundary
//   3. tab 1: press button #617 ("Search B"), then again 300 ms later
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { signature } from "../../src/ci.ts";
import type { Plan } from "../../src/cli.ts";

const APP = fileURLToPath(
  new URL("../../../../apps/palaestra", import.meta.url),
);
const ready = ["/.svelte-kit/sim-builds/v1", "/.svelte-kit/output"].some((b) =>
  existsSync(APP + b + "/server/index.js"),
);

const SEED = 2;
const PLAN: Plan = {
  actions: [
    { kind: "click", tab: 0, nth: 935 },
    { kind: "open", path: "/boundary" },
    { kind: "twice", tab: 1, nth: 617, after: 300 },
  ],
};

describe.skipIf(!ready)(
  "found: a guarded remote query runs with the value its guard rules out",
  () => {
    it("two quick searches send no query with a null argument (page-errors 69c5cc45f6)", async () => {
      process.env.SIM_APP = APP;
      const { run } = await import("../../src/cli.ts");
      const res = await run(
        SEED,
        PLAN.actions.length,
        Infinity,
        undefined,
        PLAN,
      );
      expect(res.broken.filter((b) => signature(b) === "69c5cc45f6")).toEqual(
        [],
      );
    }, 300_000);
  },
);
