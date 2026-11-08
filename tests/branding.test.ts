import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const pub = (file: string) => path.join(root, "public", file);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const ICONS: Record<string, number> = {
  "clawmaven-logo.png": 512,
  "clawmaven-favicon-48.png": 48,
  "clawmaven-favicon-32.png": 32,
  "clawmaven-apple-touch-icon.png": 180,
  "clawmaven-icon-192.png": 192,
  "clawmaven-icon-512.png": 512,
};

describe("ClawMaven branding", () => {
  it.each(["public/manifest.json", "app/root.tsx"])("%s references no agent-native-* asset", (file) => {
    expect(read(file)).not.toMatch(/agent-native-(icon|logo)/);
  });

  it.each(Object.entries(ICONS))("public/%s exists at %ipx", (file, size) => {
    expect(existsSync(pub(file))).toBe(true);
    expect(pngSize(pub(file))).toEqual([size, size]);
  });

  it("points the manifest and root icon links at ClawMaven files that exist", () => {
    const manifest = JSON.parse(read("public/manifest.json")) as { name: string; icons: { src: string }[] };
    expect(manifest.name).toBe("ClawMaven Spend Desk");
    for (const icon of manifest.icons) {
      expect(icon.src).toMatch(/^clawmaven-/);
      expect(existsSync(pub(icon.src))).toBe(true);
    }
    const hrefs = [...read("app/root.tsx").matchAll(/appPath\("\/([^"]+\.(?:png|svg))"\)/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^clawmaven-/);
      expect(existsSync(pub(href))).toBe(true);
    }
  });

  // The framework's sign-in page hardcodes these paths, so they must hold ClawMaven art.
  it.each(["favicon.svg", "icon-180.svg", "agent-native-icon-dark.svg", "agent-native-icon-light.svg"])(
    "framework-hardcoded public/%s shows the ClawMaven mark",
    (file) => {
      expect(readFileSync(pub(file), "utf8")).toContain("<title>ClawMaven</title>");
    },
  );
});
