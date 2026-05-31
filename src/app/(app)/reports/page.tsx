import { redirect } from "next/navigation";

import { ReportsPageClient } from "@/components/reports/ReportsPageClient";
import { auth } from "@/lib/auth";

export default async function ReportsPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	return <ReportsPageClient userId={session.user.id} />;
}
