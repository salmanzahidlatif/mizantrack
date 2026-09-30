"use client";

import { liveQuery } from "dexie";
import { startTransition, useEffect, useMemo, useState, type DependencyList } from "react";

type DeferredHandle = () => void;

interface DeferredLiveQueryOptions {
	timeoutMs?: number;
	label?: string;
}

export interface DeferredLiveQueryState<T> {
	value: T | undefined;
	error: unknown;
	isLoading: boolean;
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

export function useDeferredLiveQueryState<T>(
	querier: () => T | Promise<T>,
	dependencies: DependencyList,
	options: DeferredLiveQueryOptions = {}
): DeferredLiveQueryState<T> {
	const { label = "deferred live query", timeoutMs = 500 } = options;
	const queryKey = useMemo(
		() => dependencies.map(serializeDependency).join("\u001f"),
		dependencies
	);
	const [state, setState] = useState<{
		queryKey: string;
		value: T | undefined;
		error: unknown;
		isLoading: boolean;
	}>(() => ({
		queryKey,
		value: undefined,
		error: undefined,
		isLoading: true,
	}));

	useEffect(() => {
		let cancelled = false;
		let unsubscribe: DeferredHandle | undefined;

		startTransition(() => {
			setState((current) =>
				current.queryKey === queryKey &&
				current.value === undefined &&
				current.error === undefined &&
				current.isLoading
					? current
					: { queryKey, value: undefined, error: undefined, isLoading: true }
			);
		});

		const cancelSchedule = scheduleAfterFirstPaint(() => {
			if (cancelled) return;

			const subscription = liveQuery(querier).subscribe({
				next(value) {
					if (cancelled) return;
					startTransition(() => {
						setState({ queryKey, value, error: undefined, isLoading: false });
					});
				},
				error(error) {
					if (!cancelled) {
						console.error(`Failed to resolve ${label}.`, error);
						startTransition(() => {
							setState({ queryKey, value: undefined, error, isLoading: false });
						});
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

	return state.queryKey === queryKey
		? {
				value: state.value,
				error: state.error,
				isLoading: state.isLoading,
			}
		: {
				value: undefined,
				error: undefined,
				isLoading: true,
			};
}

export function useDeferredLiveQuery<T>(
	querier: () => T | Promise<T>,
	dependencies: DependencyList,
	options: DeferredLiveQueryOptions = {}
): T | undefined {
	const state = useDeferredLiveQueryState(querier, dependencies, options);
	if (state.error) throw state.error;
	return state.value;
}
