"use client";

import { liveQuery } from "dexie";
import { startTransition, useEffect, useMemo, useState, type DependencyList } from "react";

type DeferredHandle = () => void;

interface DeferredLiveQueryOptions {
	timeoutMs?: number;
	label?: string;
}

function serializeDependency(value: unknown): string {
	if (value instanceof Date) return `date:${value.getTime()}`;
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	return `${typeof value}:${String(value)}`;
}

function scheduleAfterFirstPaint(callback: () => void, timeoutMs: number): DeferredHandle {
	if (typeof window === "undefined") {
		const timer = setTimeout(callback, 0);
		return () => clearTimeout(timer);
	}

	const requestIdle = window.requestIdleCallback;
	if (requestIdle) {
		const idleId = requestIdle(callback, { timeout: timeoutMs });
		return () => window.cancelIdleCallback?.(idleId);
	}

	const timer = window.setTimeout(callback, 32);
	return () => window.clearTimeout(timer);
}

export function useDeferredLiveQuery<T>(
	querier: () => T | Promise<T>,
	dependencies: DependencyList,
	options: DeferredLiveQueryOptions = {}
): T | undefined {
	const { label = "deferred live query", timeoutMs = 500 } = options;
	const queryKey = useMemo(
		() => dependencies.map(serializeDependency).join("\u001f"),
		dependencies
	);
	const [state, setState] = useState<{ queryKey: string; value: T | undefined }>(() => ({
		queryKey,
		value: undefined,
	}));

	useEffect(() => {
		let cancelled = false;
		let unsubscribe: DeferredHandle | undefined;

		startTransition(() => {
			setState((current) =>
				current.queryKey === queryKey && current.value === undefined
					? current
					: { queryKey, value: undefined }
			);
		});

		const cancelSchedule = scheduleAfterFirstPaint(() => {
			if (cancelled) return;

			const subscription = liveQuery(querier).subscribe({
				next(value) {
					if (cancelled) return;
					startTransition(() => {
						setState({ queryKey, value });
					});
				},
				error(error) {
					if (!cancelled) {
						console.error(`Failed to resolve ${label}.`, error);
					}
				},
			});
			unsubscribe = () => subscription.unsubscribe();
		}, timeoutMs);

		return () => {
			cancelled = true;
			cancelSchedule();
			unsubscribe?.();
		};
	}, [queryKey]);

	return state.queryKey === queryKey ? state.value : undefined;
}
