"use client";

import { useEffect, useRef, useState } from "react";

import { useDeferredLiveQueryState } from "@/hooks/useDeferredLiveQuery";
import {
	getCachedAnalyticsReadState,
	getOrComputeCachedAnalyticsValue,
	type CachedAnalyticsReadState,
} from "@/lib/analytics/cache";

import type { AnalyticsSourceData } from "@/lib/analytics/cacheMetadata";
import type {
	AccountsAnalytics,
	AnalyticsMonthSummaryItem,
	PeriodAnalytics,
} from "@/lib/analytics/periodAnalytics";

type AnalyticsCacheNamespace = "accounts" | "periods" | "monthlySummaries";

type CachedAnalyticsValueByNamespace = {
	accounts: AccountsAnalytics;
	periods: PeriodAnalytics;
	monthlySummaries: AnalyticsMonthSummaryItem[];
};

interface UseCachedAnalyticsValueOptions<TNamespace extends AnalyticsCacheNamespace> {
	userId: string;
	namespace: TNamespace;
	cacheKey: string | undefined;
	dependencies: unknown[];
	label: string;
	compute: (
		source: AnalyticsSourceData
	) =>
		| CachedAnalyticsValueByNamespace[TNamespace]
		| Promise<CachedAnalyticsValueByNamespace[TNamespace]>;
}

function serializeDependency(value: unknown): string {
	if (value instanceof Date) return `date:${value.getTime()}`;
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	return `${typeof value}:${String(value)}`;
}

export function useCachedAnalyticsValue<TNamespace extends AnalyticsCacheNamespace>({
	userId,
	namespace,
	cacheKey,
	dependencies,
	label,
	compute,
}: UseCachedAnalyticsValueOptions<TNamespace>):
	| CachedAnalyticsValueByNamespace[TNamespace]
	| undefined {
	const requestKey = [
		userId,
		namespace,
		cacheKey ?? "no-cache-key",
		...dependencies.map(serializeDependency),
	].join("\u001f");
	const requestedTokensRef = useRef(new Set<string>());
	const [writeError, setWriteError] = useState<unknown>();
	// Rendering must never depend on the cache validating. If a freshly written
	// entry reads back as invalid, the token guard would block any retry and the
	// screen would load forever, so the computed value is kept as the fallback.
	const [computedValue, setComputedValue] = useState<
		CachedAnalyticsValueByNamespace[TNamespace] | undefined
	>();
	const computeRef = useRef(compute);
	computeRef.current = compute;
	const readState = useDeferredLiveQueryState<CachedAnalyticsReadState<TNamespace> | undefined>(
		async () => {
			if (!userId || !cacheKey) return undefined;
			return getCachedAnalyticsReadState(userId, namespace, cacheKey);
		},
		[userId, namespace, cacheKey],
		{ label: `${label} cache read` }
	);
	const cached = readState.value;

	useEffect(() => {
		requestedTokensRef.current.clear();
		setWriteError(undefined);
		setComputedValue(undefined);
	}, [requestKey]);

	useEffect(() => {
		if (!userId || !cacheKey || readState.isLoading || cached?.value !== undefined) return;

		const token = cached?.token ?? "missing";
		if (requestedTokensRef.current.has(token)) return;
		requestedTokensRef.current.add(token);

		let cancelled = false;
		void getOrComputeCachedAnalyticsValue(userId, namespace, cacheKey, (source) =>
			computeRef.current(source)
		)
			.then((value) => {
				if (cancelled) return;
				setComputedValue(value);
				setWriteError(undefined);
			})
			.catch((error) => {
				console.error(`Failed to recompute ${label}.`, error);
				if (!cancelled) setWriteError(error);
			});

		return () => {
			cancelled = true;
		};
	}, [userId, namespace, cacheKey, label, readState.isLoading, cached?.value, cached?.token]);

	if (readState.error) throw readState.error;
	if (writeError) throw writeError;
	return cached?.value ?? computedValue;
}
