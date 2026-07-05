import { redirect } from "next/navigation";

import { ZakatPageClientEnhanced } from "@/components/zakat/ZakatPageClientEnhanced";
import { auth } from "@/lib/auth";

export default async function ZakatPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	return <ZakatPageClientEnhanced userId={session.user.id} />;
}
