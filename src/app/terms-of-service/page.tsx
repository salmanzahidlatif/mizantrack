import { LegalPage } from "@/components/marketing/LegalPage";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Terms of Service | MizanTrack",
	description:
		"Plain-English terms for using MizanTrack as a personal finance and zakat tracking tool.",
	alternates: {
		canonical: "/terms-of-service",
	},
};

export default function TermsOfServicePage() {
	return (
		<LegalPage
			title="Terms of Service"
			description="These terms explain the limits and responsibilities that come with using MizanTrack for personal finance and zakat tracking."
			lastUpdated="October 8, 2026"
			sections={[
				{
					title: "Use of the app",
					body: (
						<>
							<p>
								MizanTrack is provided to help you record and review personal finance information,
								budgets, imports, and zakat-related calculations. You may use it for lawful personal
								purposes and are responsible for the data, cloud projects, and backup files you
								connect to it.
							</p>
						</>
					),
				},
				{
					title: "Your responsibility for financial records",
					body: (
						<>
							<p>
								You are responsible for entering accurate data, reviewing imports, checking
								balances, and verifying reports before relying on them. MizanTrack can contain bugs,
								stale cached data, incomplete imports, or configuration mistakes.
							</p>
							<p>
								Do not use MizanTrack as the only source for tax, accounting, investment, banking,
								or legal decisions. Keep independent records where those records matter.
							</p>
						</>
					),
				},
				{
					title: "Zakat calculations are a convenience",
					body: (
						<>
							<p>
								Zakat features are provided as calculation aids only. They are not religious,
								financial, tax, or legal advice. You are responsible for confirming nisab values,
								eligible assets, liabilities, dates, exchange rates, and any school-specific rules
								with a qualified scholar or adviser.
							</p>
						</>
					),
				},
				{
					title: "User-owned services",
					body: (
						<>
							<p>
								If you enable Firebase sync or Google Sheets backup, you are responsible for the
								Google Cloud, Firebase, and Google Drive accounts and permissions you configure. You
								are also responsible for any costs, quotas, sharing settings, data retention, or
								security rules in those services.
							</p>
						</>
					),
				},
				{
					title: "No warranty",
					body: (
						<>
							<p>
								MizanTrack is provided as is and as available. There is no promise that it will be
								error-free, uninterrupted, compatible with every browser or device, or suitable for
								a particular purpose.
							</p>
						</>
					),
				},
				{
					title: "Limitation of liability",
					body: (
						<>
							<p>
								To the maximum extent permitted by law, the developer is not liable for financial
								losses, missed obligations, data loss, incorrect calculations, failed sync or
								backup, service outages, or other damages arising from use of MizanTrack.
							</p>
						</>
					),
				},
				{
					title: "Changes",
					body: (
						<>
							<p>
								These terms may be updated as the app changes. Continued use after an update means
								you accept the updated terms.
							</p>
						</>
					),
				},
				{
					title: "Contact",
					body: (
						<>
							<p>
								Questions about these terms can be raised with the project owner at{" "}
								<a
									href="https://github.com/salmanzahidlatif/mizantrack/issues"
									className="text-foreground underline underline-offset-4">
									github.com/salmanzahidlatif/mizantrack/issues
								</a>
								.
							</p>
						</>
					),
				},
			]}
		/>
	);
}
