import { redirect } from "next/navigation";

import { ZakatPageClient } from "@/components/zakat/ZakatPageClient";
import { auth } from "@/lib/auth";

export default async function ZakatPage() {
	const session = await auth();
	if (!session) redirect("/login");

	return <ZakatPageClient userId={session.user.id} />;
}
