"use client";

import { AppLockSettings } from "@/components/settings/AppLockSettings";
import { ExportPanel } from "@/components/settings/ExportPanel";
import { FirebaseSyncPanel } from "@/components/settings/FirebaseSyncPanel";
import { ImportPanel } from "@/components/settings/ImportPanel";
import { PreferencesForm } from "@/components/settings/PreferencesForm";

interface SettingsPageClientProps {
	userId: string;
	userDisplay?: string | null;
}

export function SettingsPageClient({ userId, userDisplay }: SettingsPageClientProps) {
	return (
		<div className="space-y-5">
			<div>
				<h1 className="text-2xl font-bold">Settings</h1>
				<p className="text-sm text-muted-foreground">Manage your preferences and data</p>
			</div>

			<PreferencesForm userId={userId} />

			<AppLockSettings userId={userId} userDisplay={userDisplay} />

			<div className="grid gap-4 sm:grid-cols-2">
				<ImportPanel userId={userId} />
				<ExportPanel userId={userId} />
			</div>

			<FirebaseSyncPanel userId={userId} />
		</div>
	);
}
