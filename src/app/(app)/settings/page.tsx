import { redirect } from "next/navigation";

import { SettingsPageClient } from "@/components/settings/SettingsPageClient";
import { auth } from "@/lib/auth";

export default async function SettingsPage() {
	const session = await auth();
	if (!session) redirect("/login");

	return <SettingsPageClient userId={session.user.id} />;
}
