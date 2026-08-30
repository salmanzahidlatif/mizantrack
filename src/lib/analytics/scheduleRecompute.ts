import { doc, setDoc } from "firebase/firestore";

import { computeDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { getFirestoreForUser } from "@/lib/db/firebase";
import { db } from "@/lib/db/local";

const RECOMPUTE_DELAY_MS = 800;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const activeRuns = new Map<string, Promise<void>>();
const rerunAfterActive = new Set<string>();

function clearPendingTimer(userId: string) {
	const timer = timers.get(userId);
	if (!timer) return;
	clearTimeout(timer);
	timers.delete(userId);
}

async function persistDashboardStats(userId: string) {
	const stats = await computeDashboardStats(userId);
	await db.dashboardStats.put(stats);

	const firestore = await getFirestoreForUser(userId);
	if (!firestore) return;

	try {
		await setDoc(doc(firestore, `users/${userId}/analytics`, "dashboard"), stats);
	} catch (error) {
		console.warn("Dashboard analytics push skipped:", error);
	}
}

async function runRecompute(userId: string): Promise<void> {
	const active = activeRuns.get(userId);
	if (active) {
		rerunAfterActive.add(userId);
		await active;
		return;
	}

	const run = persistDashboardStats(userId).finally(() => {
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

	clearPendingTimer(userId);
	timers.set(
		userId,
		setTimeout(() => {
			timers.delete(userId);
			void runRecompute(userId).catch((error) => {
				console.error("Dashboard analytics recompute failed:", error);
			});
		}, RECOMPUTE_DELAY_MS)
	);
}

export async function recomputeAnalyticsNow(userId: string): Promise<void> {
	if (!userId) return;

	clearPendingTimer(userId);
	await runRecompute(userId);
}

export async function flushAnalyticsRecompute(userId?: string): Promise<void> {
	if (userId) {
		if (timers.has(userId)) {
			clearPendingTimer(userId);
			await runRecompute(userId);
			return;
		}

		const active = activeRuns.get(userId);
		if (active) await active;
		return;
	}

	const users = new Set([...timers.keys(), ...activeRuns.keys()]);
	await Promise.all([...users].map((pendingUserId) => flushAnalyticsRecompute(pendingUserId)));
}
