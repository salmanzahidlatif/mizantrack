import { doc, setDoc } from "firebase/firestore";

import { invalidateAnalyticsCache } from "@/lib/analytics/cache";
import { ANALYTICS_CACHE_LOGIC_VERSION } from "@/lib/analytics/cacheMetadata";
import {
	computeDashboardStats,
	sanitizeDashboardStats,
} from "@/lib/analytics/computeDashboardStats";
import { getFirestoreForUser } from "@/lib/db/firebase";
import { db } from "@/lib/db/local";

const RECOMPUTE_DELAY_MS = 0;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingInvalidations = new Map<string, Promise<void>>();
const activeRuns = new Map<string, Promise<void>>();
const rerunAfterActive = new Set<string>();

function hasAnalyticsCacheTable(): boolean {
	const localDb = db as typeof db & {
		dashboardStats?: {
			get?: unknown;
			put?: unknown;
		};
	};

	return (
		typeof localDb.dashboardStats?.get === "function" &&
		typeof localDb.dashboardStats.put === "function"
	);
}

function clearPendingTimer(userId: string) {
	const timer = timers.get(userId);
	if (!timer) return;
	clearTimeout(timer);
	timers.delete(userId);
}

function queueAnalyticsInvalidation(userId: string): Promise<void> {
	const previous = pendingInvalidations.get(userId) ?? Promise.resolve();
	const run = previous
		.then(() => invalidateAnalyticsCache(userId))
		.catch((error) => {
			console.error("Dashboard analytics invalidation failed:", error);
		})
		.finally(() => {
			if (pendingInvalidations.get(userId) === run) {
				pendingInvalidations.delete(userId);
			}
		});
	pendingInvalidations.set(userId, run);
	return run;
}

async function persistDashboardStats(userId: string) {
	const stats = await computeDashboardStats(userId);
	await db.dashboardStats.put(stats);

	const firestore = await getFirestoreForUser(userId);
	if (!firestore) return;

	try {
		await setDoc(
			doc(firestore, `users/${userId}/analytics`, "dashboard"),
			sanitizeDashboardStats(stats)
		);
	} catch (error) {
		console.warn("Dashboard analytics push skipped:", error);
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

async function markDashboardStatsRecomputeFailed(userId: string, error: unknown) {
	const existing = await db.dashboardStats.get(userId);
	if (!existing) return;
	await db.dashboardStats.put({
		...existing,
		logicVersion: ANALYTICS_CACHE_LOGIC_VERSION,
		cacheStatus: "failed",
		cacheUpdatedAt: Date.now(),
		cacheFailedAt: Date.now(),
		cacheError: getErrorMessage(error),
	});
}

async function runRecompute(userId: string): Promise<void> {
	const active = activeRuns.get(userId);
	if (active) {
		rerunAfterActive.add(userId);
		await active;
		return;
	}

	const run = persistDashboardStats(userId)
		.catch(async (error) => {
			await markDashboardStatsRecomputeFailed(userId, error);
			throw error;
		})
		.finally(() => {
			activeRuns.delete(userId);
		});

	activeRuns.set(userId, run);
	await run;

	if (rerunAfterActive.delete(userId)) {
		await runRecompute(userId);
	}
}

export function scheduleAnalyticsRecompute(userId: string): void {
	if (!userId) return;
	if (!hasAnalyticsCacheTable()) return;

	const invalidation = queueAnalyticsInvalidation(userId);
	clearPendingTimer(userId);
	timers.set(
		userId,
		setTimeout(() => {
			timers.delete(userId);
			void invalidation
				.then(() => runRecompute(userId))
				.catch((error) => {
					console.error("Dashboard analytics recompute failed:", error);
				});
		}, RECOMPUTE_DELAY_MS)
	);
}

export async function recomputeAnalyticsNow(userId: string): Promise<void> {
	if (!userId) return;
	if (!hasAnalyticsCacheTable()) return;

	clearPendingTimer(userId);
	await invalidateAnalyticsCache(userId);
	await runRecompute(userId);
}

export async function flushAnalyticsRecompute(userId?: string): Promise<void> {
	if (userId) {
		if (timers.has(userId)) {
			clearPendingTimer(userId);
			await pendingInvalidations.get(userId);
			await runRecompute(userId);
			return;
		}

		await pendingInvalidations.get(userId);
		const active = activeRuns.get(userId);
		if (active) await active;
		return;
	}

	const users = new Set([...timers.keys(), ...pendingInvalidations.keys(), ...activeRuns.keys()]);
	await Promise.all([...users].map((pendingUserId) => flushAnalyticsRecompute(pendingUserId)));
}
