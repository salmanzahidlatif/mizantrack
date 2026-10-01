import React from "react";

import { AuthenticatedAppShell } from "@/components/auth/AuthenticatedAppShell";

export const dynamic = "error";

export default function AppLayout({ children }: { children: React.ReactNode }) {
	return <AuthenticatedAppShell>{children}</AuthenticatedAppShell>;
}
