import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const toml = readFileSync(path.resolve(__dirname, "../netlify.toml"), "utf8");

describe("netlify.toml", () => {
  it.each(["G-ESF7FYXGN9", "GTM-N3WSTXZ", "starter.agent-native.com"])("has no starter-template value %s", (value) => {
    expect(toml).not.toContain(value);
  });

  it("keeps BETTER_AUTH_TRUSTED_ORIGINS and the hosted harness out of the file", () => {
    // Values here only reach the build and override the Netlify UI; set these in the UI.
    expect(toml).not.toMatch(/^\s*BETTER_AUTH_TRUSTED_ORIGINS\s*=/m);
    expect(toml).not.toMatch(/^\s*AGENT_NATIVE_HOSTED_HARNESS\s*=/m);
  });

  it("still builds with the netlify preset and runs production migrations", () => {
    expect(toml).toContain("NITRO_PRESET=netlify pnpm build");
    expect(toml).toContain("pnpm migrate:production");
  });
});
