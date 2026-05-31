import { initializeApp, getApps, deleteApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

import { db as localDb } from "./local";

const instanceMap = new Map<string, { app: FirebaseApp; firestore: Firestore }>();
// Serializes concurrent init calls — prevents second caller from deleteApp-ing
// the instance the first caller just created.
const initPromises = new Map<string, Promise<Firestore | null>>();

export async function getFirestoreForUser(userId: string): Promise<Firestore | null> {
	if (instanceMap.has(userId)) {
		return instanceMap.get(userId)!.firestore;
	}

	// If initialization is already in flight, await it instead of starting another.
	const inflight = initPromises.get(userId);
	if (inflight) return inflight;

	const promise = (async (): Promise<Firestore | null> => {
		const config = await localDb.dbConfig.get(userId);
		if (!config?.enabled || !config.firebaseConfig) return null;

		try {
			const parsed = JSON.parse(config.firebaseConfig);
			const appName = `mizantrack-${userId}`;

			// Clean up stale instance from Firebase's registry (e.g. after HMR).
			const existing = getApps().find((a) => a.name === appName);
			if (existing) await deleteApp(existing);

			const app = initializeApp(parsed, appName);
			const firestore = getFirestore(app);

			instanceMap.set(userId, { app, firestore });
			return firestore;
		} catch (e) {
			console.error("Firebase init failed:", e);
			return null;
		} finally {
			initPromises.delete(userId);
		}
	})();

	initPromises.set(userId, promise);
	return promise;
}

export async function resetFirestoreForUser(userId: string) {
	// Cancel any in-flight initialization so it doesn't race with the reset.
	initPromises.delete(userId);

	const instance = instanceMap.get(userId);
	if (instance) {
		await deleteApp(instance.app);
		instanceMap.delete(userId);
	}
}
