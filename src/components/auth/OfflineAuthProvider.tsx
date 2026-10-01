"use client";

import { Loader2, WifiOff } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { getSession, signOut } from "next-auth/react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

import {
	clearOfflineSessionSnapshot,
	createOfflineSessionSnapshot,
	readOfflineSessionSnapshot,
	writeOfflineSessionSnapshot,
	type OfflineSessionUser,
} from "@/lib/auth/offline-session";

interface OfflineAuthContextValue {
	user: OfflineSessionUser | null;
	isOffline: boolean;
	status: "loading" | "authenticated" | "unauthenticated";
	refresh: () => Promise<void>;
	signOut: () => Promise<void>;
}

const OfflineAuthContext = createContext<OfflineAuthContextValue | null>(null);

function getOnlineStatus() {
	if (typeof navigator === "undefined") return true;
	return navigator.onLine;
}

function LoadingScreen() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-background px-4">
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				Loading MizanTrack…
			</div>
		</main>
	);
}

function OfflineSignedOutScreen() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
			<div className="max-w-sm space-y-4">
				<div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
					<WifiOff className="h-6 w-6 text-muted-foreground" />
				</div>
				<div className="space-y-2">
					<h1 className="text-xl font-semibold">Offline sign-in unavailable</h1>
					<p className="text-sm text-muted-foreground">
						Connect to the internet once to verify your Google session. After that, MizanTrack can
						reopen this device fully offline.
					</p>
				</div>
			</div>
		</main>
	);
}

export function OfflineAuthProvider({ children }: { children: ReactNode }) {
	const router = useRouter();
	const pathname = usePathname();
	const [isOffline, setIsOffline] = useState(() => !getOnlineStatus());
	const [user, setUser] = useState<OfflineSessionUser | null>(() => {
		return readOfflineSessionSnapshot()?.user ?? null;
	});
	const [status, setStatus] = useState<OfflineAuthContextValue["status"]>(() => {
		return readOfflineSessionSnapshot()?.user ? "authenticated" : "loading";
	});

	const refresh = useCallback(async () => {
		const cached = readOfflineSessionSnapshot();
		const online = getOnlineStatus();
		setIsOffline(!online);

		if (!online) {
			setUser(cached?.user ?? null);
			setStatus(cached?.user ? "authenticated" : "unauthenticated");
			return;
		}

		try {
			const session = await getSession();
			const snapshot = createOfflineSessionSnapshot(session);
			if (snapshot) {
				writeOfflineSessionSnapshot(snapshot);
				setUser(snapshot.user);
				setStatus("authenticated");
				return;
			}

			clearOfflineSessionSnapshot();
			setUser(null);
			setStatus("unauthenticated");
		} catch {
			setUser(cached?.user ?? null);
			setStatus(cached?.user ? "authenticated" : "unauthenticated");
			setIsOffline(true);
		}
	}, []);

	const handleSignOut = useCallback(async () => {
		clearOfflineSessionSnapshot();
		setUser(null);
		setStatus("unauthenticated");

		if (getOnlineStatus()) {
			await signOut({ redirectTo: "/login" });
			return;
		}

		router.replace("/login");
	}, [router]);

	useEffect(() => {
		void refresh();

		const handleOnline = () => {
			setIsOffline(false);
			void refresh();
		};
		const handleOffline = () => {
			setIsOffline(true);
		};

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, [refresh]);

	useEffect(() => {
		if (status !== "unauthenticated") return;
		if (pathname === "/login") return;

		router.replace("/login");
	}, [pathname, router, status]);

	const value = useMemo<OfflineAuthContextValue>(
		() => ({
			user,
			isOffline,
			status,
			refresh,
			signOut: handleSignOut,
		}),
		[user, isOffline, status, refresh, handleSignOut]
	);

	return <OfflineAuthContext.Provider value={value}>{children}</OfflineAuthContext.Provider>;
}

export function RequireOfflineUser({ children }: { children: ReactNode }) {
	const { user, status, isOffline } = useOfflineAuth();

	if (status === "loading") return <LoadingScreen />;
	if (!user && isOffline) return <OfflineSignedOutScreen />;
	if (!user) return <LoadingScreen />;

	return <>{children}</>;
}

export function useOfflineAuth() {
	const value = useContext(OfflineAuthContext);
	if (!value) {
		return {
			user: null,
			isOffline: false,
			status: "unauthenticated" as const,
			refresh: async () => undefined,
			signOut: async () => undefined,
		};
	}

	return value;
}

export function useCurrentUser() {
	return useContext(OfflineAuthContext)?.user ?? null;
}
