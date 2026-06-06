import { create } from "zustand";

import { syncAll } from "@/lib/db/sync";

interface SyncStore {
	syncing: boolean;
	lastSync: number | null;
	error: string | null;

	triggerSync: (userId: string) => Promise<void>;
	setSyncing: (syncing: boolean) => void;
	setLastSync: (timestamp: number) => void;
	setError: (error: string | null) => void;
}

export const useSyncStore = create<SyncStore>((set) => ({
	syncing: false,
	lastSync: null,
	error: null,

	triggerSync: async (userId: string) => {
		set({ syncing: true, error: null });
		try {
			await syncAll(userId);
			set({ syncing: false, lastSync: Date.now(), error: null });
		} catch (err) {
			const code = err instanceof Error && "code" in err ? (err as { code: string }).code : null;
			let message: string;
			if (code === "permission-denied") {
				message = "Sync failed: permission denied. Check your Firestore security rules.";
			} else if (code === "resource-exhausted") {
				message =
					"Sync failed: Firestore daily quota exceeded. Free tier allows 20k writes and 50k reads per day. Sync will resume tomorrow.";
			} else {
				message = err instanceof Error ? err.message : "Sync failed";
			}
			set({ syncing: false, error: message });
		}
	},

	setSyncing: (syncing) => set({ syncing }),
	setLastSync: (timestamp) => set({ lastSync: timestamp }),
	setError: (error) => set({ error }),
}));
