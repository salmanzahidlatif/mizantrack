"use client";

import { useCurrentUser } from "@/components/auth/OfflineAuthProvider";
import { AppLockSettings } from "@/components/settings/AppLockSettings";
import { ExportPanel } from "@/components/settings/ExportPanel";
import { FirebaseSyncPanel } from "@/components/settings/FirebaseSyncPanel";
import { GoogleSheetsPanel } from "@/components/settings/GoogleSheetsPanel";
import { ImportPanel } from "@/components/settings/ImportPanel";
import { PreferencesForm } from "@/components/settings/PreferencesForm";
import { ResetLocalDataPanel } from "@/components/settings/ResetLocalDataPanel";
import { TransferIntegrityPanel } from "@/components/settings/TransferIntegrityPanel";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";

interface SettingsPageClientProps {
	userId?: string;
	userDisplay?: string | null;
}

export function SettingsPageClient({
	userId: providedUserId,
	userDisplay,
}: SettingsPageClientProps = {}) {
	const currentUser = useCurrentUser();
	const userId = useRequiredUserId(providedUserId);
	const displayName = userDisplay ?? currentUser?.email ?? currentUser?.name ?? undefined;

	return (
		<div className="space-y-5">
			<div>
				<h1 className="hidden text-2xl font-bold md:block">Settings</h1>
				<p className="text-sm text-muted-foreground">Manage your preferences and data</p>
			</div>

			<PreferencesForm userId={userId} />

			<AppLockSettings userId={userId} userDisplay={displayName} />

			<div className="grid gap-4 sm:grid-cols-2">
				<ImportPanel userId={userId} />
				<ExportPanel userId={userId} />
			</div>

			<FirebaseSyncPanel userId={userId} />

			<GoogleSheetsPanel userId={userId} />

			<TransferIntegrityPanel userId={userId} />

			<ResetLocalDataPanel userId={userId} />
		</div>
	);
}
