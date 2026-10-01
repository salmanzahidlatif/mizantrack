"use client";

import {
	OfflineAuthProvider,
	RequireOfflineUser,
	useCurrentUser,
} from "@/components/auth/OfflineAuthProvider";
import { AppShell } from "@/components/layout/AppShell";

function AuthenticatedShellContent({ children }: { children: React.ReactNode }) {
	const user = useCurrentUser();
	if (!user) return null;

	return <AppShell user={user}>{children}</AppShell>;
}

export function AuthenticatedAppShell({ children }: { children: React.ReactNode }) {
	return (
		<OfflineAuthProvider>
			<RequireOfflineUser>
				<AuthenticatedShellContent>{children}</AuthenticatedShellContent>
			</RequireOfflineUser>
		</OfflineAuthProvider>
	);
}
