import { redirect } from "next/navigation";

import { AccountsPageClient } from "@/components/accounts/AccountsPageClient";
import { auth } from "@/lib/auth";

export default async function AccountsPage() {
	const session = await auth();
	if (!session) redirect("/login");

	return <AccountsPageClient userId={session.user.id} />;
}
