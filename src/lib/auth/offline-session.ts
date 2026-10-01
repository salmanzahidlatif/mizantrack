import { isValidSessionUserId } from "@/lib/auth/session";

import type { Session } from "next-auth";

export const OFFLINE_SESSION_STORAGE_KEY = "mizantrack:offline-session:v1";

export interface OfflineSessionUser {
	id: string;
	name?: string | null;
	email?: string | null;
	image?: string | null;
}

export interface OfflineSessionSnapshot {
	user: OfflineSessionUser;
	verifiedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function normalizeOfflineSessionUser(user: unknown): OfflineSessionUser | null {
	if (!isRecord(user)) return null;
	if (!isValidSessionUserId(user.id)) return null;

	return {
		id: user.id.trim(),
		name: typeof user.name === "string" ? user.name : null,
		email: typeof user.email === "string" ? user.email : null,
		image: typeof user.image === "string" ? user.image : null,
	};
}

export function createOfflineSessionSnapshot(
	session: Pick<Session, "user"> | null | undefined,
	now = Date.now()
): OfflineSessionSnapshot | null {
	const user = normalizeOfflineSessionUser(session?.user);
	if (!user) return null;

	return {
		user,
		verifiedAt: now,
	};
}

export function parseOfflineSessionSnapshot(value: string | null): OfflineSessionSnapshot | null {
	if (!value) return null;

	try {
		const parsed = JSON.parse(value) as unknown;
		if (!isRecord(parsed)) return null;

		const user = normalizeOfflineSessionUser(parsed.user);
		const verifiedAt = typeof parsed.verifiedAt === "number" ? parsed.verifiedAt : 0;
		if (!user || !Number.isFinite(verifiedAt) || verifiedAt <= 0) return null;

		return { user, verifiedAt };
	} catch {
		return null;
	}
}

export function readOfflineSessionSnapshot(
	storage: Pick<Storage, "getItem"> | undefined = typeof window === "undefined"
		? undefined
		: window.localStorage
): OfflineSessionSnapshot | null {
	if (!storage) return null;

	return parseOfflineSessionSnapshot(storage.getItem(OFFLINE_SESSION_STORAGE_KEY));
}

export function writeOfflineSessionSnapshot(
	snapshot: OfflineSessionSnapshot,
	storage: Pick<Storage, "setItem"> | undefined = typeof window === "undefined"
		? undefined
		: window.localStorage
) {
	if (!storage) return;

	storage.setItem(OFFLINE_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearOfflineSessionSnapshot(
	storage: Pick<Storage, "removeItem"> | undefined = typeof window === "undefined"
		? undefined
		: window.localStorage
) {
	storage?.removeItem(OFFLINE_SESSION_STORAGE_KEY);
}
