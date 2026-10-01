import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCachedAnalyticsValue } from "@/hooks/useCachedAnalyticsValue";

import type { AnalyticsSourceData } from "@/lib/analytics/cacheMetadata";
import type { AccountsAnalytics } from "@/lib/analytics/periodAnalytics";

const cacheMock = vi.hoisted(() => ({
	readState: {
		value: undefined,
		cacheStatus: "missing",
		token: "missing",
	},
	getCachedAnalyticsReadState: vi.fn(),
	getOrComputeCachedAnalyticsValue: vi.fn(),
}));

vi.mock("@/lib/analytics/cache", () => ({
	getCachedAnalyticsReadState: cacheMock.getCachedAnalyticsReadState,
	getOrComputeCachedAnalyticsValue: cacheMock.getOrComputeCachedAnalyticsValue,
}));

const SOURCE: AnalyticsSourceData = {
	accounts: [],
	categories: [],
	transactions: [],
};

const VALUE: AccountsAnalytics = {
	userId: "hook-cache-user",
	currency: "AED",
	asOf: new Date("2026-09-30T09:37:15.923+04:00"),
	period: {
		interval: "monthly",
		key: "2026-09",
		from: new Date("2026-09-01T00:00:00.000+04:00"),
		to: new Date("2026-09-30T23:59:59.999+04:00"),
		fromMs: new Date("2026-09-01T00:00:00.000+04:00").getTime(),
		toMs: new Date("2026-09-30T23:59:59.999+04:00").getTime(),
		label: "Sep 2026",
	},
	netWorth: 123,
	inflow: 0,
	outflow: 0,
	netFlow: 0,
	accounts: [],
	allAccounts: [],
	unscopedAccounts: [],
	warnings: [],
};

class ErrorBoundary extends React.Component<
	{ children: React.ReactNode },
	{ error: Error | undefined }
> {
	state: { error: Error | undefined } = { error: undefined };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	render() {
		if (this.state.error) {
			return <div role="alert">{this.state.error.message}</div>;
		}

		return this.props.children;
	}
}

function CachedAnalyticsProbe({
	compute,
}: {
	compute: (source: AnalyticsSourceData) => AccountsAnalytics | Promise<AccountsAnalytics>;
}) {
	const value = useCachedAnalyticsValue({
		userId: "hook-cache-user",
		namespace: "accounts",
		cacheKey: "stable-key",
		label: "hook cache test",
		compute,
		dependencies: [],
	});

	if (!value) return <div>Loading analytics…</div>;
	return <div>Net worth: {value.netWorth}</div>;
}

describe("useCachedAnalyticsValue", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		cacheMock.getCachedAnalyticsReadState.mockResolvedValue(cacheMock.readState);
		cacheMock.getOrComputeCachedAnalyticsValue.mockImplementation(
			async (
				_userId: string,
				_namespace: string,
				_key: string,
				compute: (source: AnalyticsSourceData) => AccountsAnalytics | Promise<AccountsAnalytics>
			) => compute(SOURCE)
		);
	});

	it("returns a computed value even when the cache never validates", async () => {
		const compute = vi.fn(() => VALUE);
		render(<CachedAnalyticsProbe compute={compute} />);

		expect(screen.getByText("Loading analytics…")).toBeInTheDocument();

		await waitFor(() => {
			expect(screen.getByText("Net worth: 123")).toBeInTheDocument();
		});
		expect(screen.queryByText("Loading analytics…")).not.toBeInTheDocument();
		expect(compute).toHaveBeenCalledTimes(1);
	});

	it("surfaces recompute errors instead of loading forever", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		cacheMock.getOrComputeCachedAnalyticsValue.mockRejectedValue(new Error("recompute failed"));

		render(
			<ErrorBoundary>
				<CachedAnalyticsProbe compute={() => VALUE} />
			</ErrorBoundary>
		);

		expect(screen.getByText("Loading analytics…")).toBeInTheDocument();

		await waitFor(() => {
			expect(screen.getByRole("alert")).toHaveTextContent("recompute failed");
		});
		expect(screen.queryByText("Loading analytics…")).not.toBeInTheDocument();
	});

	it("bounds recomputation for stable cache state and dependencies", async () => {
		const compute = vi.fn(() => VALUE);
		const { rerender } = render(<CachedAnalyticsProbe compute={compute} />);

		await waitFor(() => {
			expect(screen.getByText("Net worth: 123")).toBeInTheDocument();
		});

		rerender(<CachedAnalyticsProbe compute={compute} />);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(compute).toHaveBeenCalledTimes(1);
		expect(cacheMock.getOrComputeCachedAnalyticsValue).toHaveBeenCalledTimes(1);
	});
});
