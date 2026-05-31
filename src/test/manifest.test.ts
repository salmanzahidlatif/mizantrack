/**
 * Regression tests for public/manifest.json
 * Covers: required PWA fields for browser installability (FR-PWA-005, FR-PWA-006)
 */
import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
	readFileSync(resolve(__dirname, "../../public/manifest.json"), "utf8"),
) as Record<string, unknown>;

describe("manifest.json", () => {
	it("hasRequiredInstallabilityFields", () => {
		expect(manifest).toHaveProperty("name");
		expect(manifest).toHaveProperty("short_name");
		expect(manifest).toHaveProperty("start_url");
		expect(manifest).toHaveProperty("display");
		expect(manifest).toHaveProperty("scope");
		expect(manifest).toHaveProperty("id");
		expect(manifest).toHaveProperty("orientation");
		expect(manifest).toHaveProperty("lang");
		expect(manifest).toHaveProperty("categories");
	});

	it("hasAtLeastOneMaskableIcon", () => {
		const icons = manifest.icons as Array<{ src: string; sizes: string; purpose?: string }>;
		expect(Array.isArray(icons)).toBe(true);
		const hasMaskable = icons.some(
			(icon) => typeof icon.purpose === "string" && icon.purpose.includes("maskable"),
		);
		expect(hasMaskable).toBe(true);
	});

	it("hasBothIconSizes", () => {
		const icons = manifest.icons as Array<{ sizes: string }>;
		const sizes = icons.map((i) => i.sizes);
		expect(sizes).toContain("192x192");
		expect(sizes).toContain("512x512");
	});
});
