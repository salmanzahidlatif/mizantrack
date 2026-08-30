import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/local";

import type { DashboardStats } from "@/types";

export function useDashboardStats(userId: string): DashboardStats | undefined {
	return useLiveQuery(() => db.dashboardStats.get(userId), [userId]);
}
