import { redirect } from "next/navigation";

import { TransactionsPageClient } from "@/components/transactions/TransactionsPageClient";
import { auth } from "@/lib/auth";

export default async function TransactionsPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	return <TransactionsPageClient userId={session.user.id} />;
}
