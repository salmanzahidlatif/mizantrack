import { MarketingLandingPage } from "@/components/marketing/MarketingLandingPage";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "MizanTrack | Private Personal Finance and Zakat Tracker",
	description:
		"Offline-first personal finance and zakat tracking for accounts, budgets, analytics, imports, and optional user-owned Firebase or Google Sheets backup.",
	alternates: {
		canonical: "/",
	},
};

export default function RootPage() {
	return <MarketingLandingPage />;
}
