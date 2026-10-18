"use client";

import { FiscalReportPanel } from "@/components/reports/FiscalReportPanel";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";

interface ReportsPageClientProps {
	userId?: string;
}

export function ReportsPageClient({ userId: providedUserId }: ReportsPageClientProps = {}) {
	const userId = useRequiredUserId(providedUserId);

	return (
		<div className="space-y-5">
			<h1 className="hidden text-2xl font-bold md:block">Reports</h1>

			<FiscalReportPanel userId={userId} />
		</div>
	);
}
