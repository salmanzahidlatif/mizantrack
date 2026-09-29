"use client";

import { AppLockSettings } from "@/components/settings/AppLockSettings";
import { ExportPanel } from "@/components/settings/ExportPanel";
import { FirebaseSyncPanel } from "@/components/settings/FirebaseSyncPanel";
import { ImportPanel } from "@/components/settings/ImportPanel";
import { PreferencesForm } from "@/components/settings/PreferencesForm";
import { ResetLocalDataPanel } from "@/components/settings/ResetLocalDataPanel";

interface SettingsPageClientProps {
	userId: string;
	userDisplay?: string | null;
}

export function SettingsPageClient({ userId, userDisplay }: SettingsPageClientProps) {
	return (
		<div className="space-y-5">
			<div>
				<h1 className="hidden text-2xl font-bold md:block">Settings</h1>
				<p className="text-sm text-muted-foreground">Manage your preferences and data</p>
			</div>

			<PreferencesForm userId={userId} />

			<AppLockSettings userId={userId} userDisplay={userDisplay} />

			<div className="grid gap-4 sm:grid-cols-2">
				<ImportPanel userId={userId} />
				<ExportPanel userId={userId} />
			</div>

			<FirebaseSyncPanel userId={userId} />

			<ResetLocalDataPanel userId={userId} />
		</div>
	);
}
