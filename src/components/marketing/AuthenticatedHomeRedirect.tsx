"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { readOfflineSessionSnapshot } from "@/lib/auth/offline-session";

export function AuthenticatedHomeRedirect() {
	const router = useRouter();

	useEffect(() => {
		try {
			if (readOfflineSessionSnapshot()?.user) {
				router.replace("/dashboard");
			}
		} catch {
			// If browser storage is unavailable, keep the public page visible.
		}
	}, [router]);

	return null;
}
