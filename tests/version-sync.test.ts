import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("version sync", () => {
  it("package.json, APP_VERSION and the top CHANGELOG entry carry the same version", () => {
    const pkg = JSON.parse(read("package.json")).version as string;
    const app = read("app/lib/app-config.ts").match(/APP_VERSION = "([^"]+)"/)?.[1];
    const changelog = read("CHANGELOG.md").match(/^## (\S+)/m)?.[1];
    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/);
    expect({ app, changelog }).toEqual({ app: pkg, changelog: pkg });
  });
});
