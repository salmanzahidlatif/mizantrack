import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDeferredLiveQueryState } from "@/hooks/useDeferredLiveQuery";

afterEach(() => {
	vi.restoreAllMocks();
});

function ThrowingDeferredQuery() {
	const state = useDeferredLiveQueryState(
		async () => {
			throw new Error("deferred query exploded");
		},
		[],
		{ label: "throwing test query", timeoutMs: 0 }
	);

	if (state.isLoading) return <div>Loading analytics…</div>;
	if (state.error instanceof Error) return <div role="alert">{state.error.message}</div>;
	return <div>Loaded</div>;
}

describe("useDeferredLiveQuery", () => {
	it("surfaces query errors instead of loading forever", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		render(<ThrowingDeferredQuery />);

		expect(screen.getByText("Loading analytics…")).toBeInTheDocument();

		await waitFor(() => {
			expect(screen.getByRole("alert")).toHaveTextContent("deferred query exploded");
		});
		expect(screen.queryByText("Loading analytics…")).not.toBeInTheDocument();
	});
});
