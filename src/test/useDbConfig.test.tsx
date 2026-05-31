import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDbConfig } from "@/hooks/useDbConfig";
import { db } from "@/lib/db/local";

describe("useDbConfig", () => {
	it("useDbConfig_MissingUserId_DoesNotThrowAndReturnsUndefined", () => {
		const getSpy = vi.spyOn(db.dbConfig, "get");
		const render = () => renderHook(() => useDbConfig(undefined as unknown as string));

		expect(render).not.toThrow();
		expect(render().result.current).toBeUndefined();
		expect(getSpy).not.toHaveBeenCalled();
	});
});