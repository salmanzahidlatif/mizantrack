import { initializeApp, getApps, deleteApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

import { db as localDb } from "./local";

const instanceMap = new Map<string, { app: FirebaseApp; firestore: Firestore }>();

export async function getFirestoreForUser(userId: string): Promise<Firestore | null> {
	if (instanceMap.has(userId)) {
		return instanceMap.get(userId)!.firestore;
	}

	const config = await localDb.dbConfig.get(userId);
	if (!config?.enabled || !config.firebaseConfig) return null;

	try {
		const parsed = JSON.parse(config.firebaseConfig);
		const appName = `mizantrack-${userId}`;

		// Clean up stale instance if exists
		const existing = getApps().find((a) => a.name === appName);
		if (existing) await deleteApp(existing);

		const app = initializeApp(parsed, appName);
		const firestore = getFirestore(app);

		instanceMap.set(userId, { app, firestore });
		return firestore;
	} catch (e) {
		console.error("Firebase init failed:", e);
		return null;
	}
}

export async function resetFirestoreForUser(userId: string) {
	const instance = instanceMap.get(userId);
	if (instance) {
		await deleteApp(instance.app);
		instanceMap.delete(userId);
	}
}
