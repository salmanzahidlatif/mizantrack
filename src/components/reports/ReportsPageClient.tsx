"use client";

import { useState } from "react";

import { FiscalReportPanel } from "@/components/reports/FiscalReportPanel";
import { ReportsAnalyticsOverview } from "@/components/reports/ReportsAnalyticsOverview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";

interface ReportsPageClientProps {
	userId?: string;
}

export function ReportsPageClient({ userId: providedUserId }: ReportsPageClientProps = {}) {
	const userId = useRequiredUserId(providedUserId);
	const [activeTab, setActiveTab] = useState("overview");

	return (
		<div className="space-y-5">
			<h1 className="hidden text-2xl font-bold md:block">Reports</h1>

			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className="grid w-full grid-cols-2">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="fiscal">Fiscal report</TabsTrigger>
				</TabsList>

				<TabsContent value="overview" className="space-y-5">
					<ReportsAnalyticsOverview userId={userId} />
				</TabsContent>

				<TabsContent value="fiscal" className="space-y-5">
					<FiscalReportPanel userId={userId} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
