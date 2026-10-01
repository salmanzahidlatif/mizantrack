import { AutoGoogleSignIn } from "@/components/auth/AutoGoogleSignIn";
import { OfflineAuthProvider } from "@/components/auth/OfflineAuthProvider";

export const dynamic = "error";

export default function LoginPage() {
	return (
		<OfflineAuthProvider>
			<AutoGoogleSignIn />
		</OfflineAuthProvider>
	);
}
