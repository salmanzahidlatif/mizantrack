import { create } from "zustand";

import { syncAll } from "@/lib/db/sync";

import type { SyncResult } from "@/lib/db/sync";

export interface SyncProgress {
	totalPushed: number;
	totalPulled: number;
}

interface SyncStore {
	syncing: boolean;
	lastSync: number | null;
	error: string | null;
	/** Live counts updated as each table finishes during an active sync. */
	syncProgress: SyncProgress | null;
	/** Final counts from the last completed sync. */
	lastSyncResult: SyncResult | null;
	/**
	 * Timestamp until which auto-sync should be suppressed.
	 * Set to next-day midnight when resource-exhausted is returned.
	 * Prevents the 5-minute interval from hammering a depleted quota.
	 */
	suppressAutoSyncUntil: number | null;

	triggerSync: (userId: string) => Promise<void>;
	setSyncing: (syncing: boolean) => void;
	setLastSync: (timestamp: number) => void;
	setError: (error: string | null) => void;
}

function nextMidnightMs(): number {
	const d = new Date();
	d.setDate(d.getDate() + 1);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export const useSyncStore = create<SyncStore>((set) => ({
	syncing: false,
	lastSync: null,
	error: null,
	syncProgress: null,
	lastSyncResult: null,
	suppressAutoSyncUntil: null,

	triggerSync: async (userId: string) => {
		set({ syncing: true, error: null, syncProgress: { totalPushed: 0, totalPulled: 0 } });
		try {
			const result = await syncAll(userId, ({ totalPushed, totalPulled }) => {
				set({ syncProgress: { totalPushed, totalPulled } });
			});
			set({
				syncing: false,
				lastSync: Date.now(),
				error: null,
				syncProgress: null,
				lastSyncResult: result,
			});
		} catch (err) {
			const code = err instanceof Error && "code" in err ? (err as { code: string }).code : null;
			let message: string;
			let suppressAutoSyncUntil: number | null = null;
			if (code === "permission-denied") {
				message = "Sync failed: permission denied. Check your Firestore security rules.";
			} else if (code === "resource-exhausted") {
				message =
					"Sync failed: Firestore daily quota exceeded. Free tier allows 20k writes and 50k reads per day. Sync will resume tomorrow.";
				// Suppress auto-sync until midnight to avoid hammering the quota
				suppressAutoSyncUntil = nextMidnightMs();
			} else {
				message = err instanceof Error ? err.message : "Sync failed";
			}
			set({ syncing: false, error: message, syncProgress: null, suppressAutoSyncUntil });
		}
	},

	setSyncing: (syncing) => set({ syncing }),
	setLastSync: (timestamp) => set({ lastSync: timestamp }),
	setError: (error) => set({ error }),
}));
