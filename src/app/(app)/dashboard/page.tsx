import { redirect } from "next/navigation";

import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";
import { auth } from "@/lib/auth";

export default async function DashboardPage() {
	const session = await auth();
	if (!session) redirect("/login");

	return <DashboardPageClient userId={session.user.id} />;
}
