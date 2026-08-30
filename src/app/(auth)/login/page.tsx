import { redirect } from "next/navigation";

import { AutoGoogleSignIn } from "@/components/auth/AutoGoogleSignIn";
import { auth } from "@/lib/auth";

export default async function LoginPage() {
	const session = await auth();
	if (session?.user?.id) redirect("/dashboard");

	return <AutoGoogleSignIn />;
}
