import { redirect } from "next/navigation";

import { CategoriesPageClient } from "@/components/categories/CategoriesPageClient";
import { auth } from "@/lib/auth";

export default async function CategoriesPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	return <CategoriesPageClient userId={session.user.id} />;
}
