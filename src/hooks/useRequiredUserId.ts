"use client";

import { useCurrentUser } from "@/components/auth/OfflineAuthProvider";

export function useRequiredUserId(providedUserId?: string): string {
	const currentUser = useCurrentUser();
	return providedUserId ?? currentUser?.id ?? "";
}
