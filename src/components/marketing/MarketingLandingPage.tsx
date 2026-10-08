import Link from "next/link";

import { AuthenticatedHomeRedirect } from "@/components/marketing/AuthenticatedHomeRedirect";
import { PublicPageFrame } from "@/components/marketing/PublicChrome";
import { Button } from "@/components/ui/button";

const features = [
	{
		title: "Accounts and transactions",
		description:
			"Track balances, transfers, income, expenses, tags, places, and travel-currency details across multiple currencies.",
	},
	{
		title: "Budgets and category analytics",
		description:
			"Review spending by category, account, currency, and reporting period so your personal budget stays understandable.",
	},
	{
		title: "Zakat tools",
		description:
			"Record gold holdings, account balances, nisab settings, calculations, and payments in one place for easier review.",
	},
	{
		title: "Hysab Kytab imports",
		description:
			"Bring in data from Hysab Kytab backup files and keep source identifiers for safer repeat imports.",
	},
] as const;

const privacyPoints = [
	"Your day-to-day finance data is stored locally in this browser using IndexedDB via Dexie.",
	"Firebase sync is optional and uses a Firebase project that you configure and own.",
	"Google Sheets backup is optional, one-way, and writes spreadsheets in your own Google Drive.",
] as const;

export function MarketingLandingPage() {
	return (
		<PublicPageFrame>
			<AuthenticatedHomeRedirect />
			<main>
				<section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:py-18">
					<div className="space-y-7">
						<div className="inline-flex rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
							Private, offline-first, and owner-configured
						</div>
						<div className="space-y-5">
							<h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
								Personal finance and zakat tracking without a central data silo.
							</h1>
							<p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
								MizanTrack helps individuals track accounts, transactions, budgets, category
								analytics, and zakat calculations. It is designed as an offline-first PWA where your
								records live in your browser unless you choose to connect your own cloud services.
							</p>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row">
							<Button asChild size="lg">
								<Link href="/login">Sign in with Google</Link>
							</Button>
							<Button asChild variant="outline" size="lg">
								<Link href="/privacy">Read the privacy policy</Link>
							</Button>
						</div>
					</div>

					<aside className="rounded-[2rem] border border-border/70 bg-card p-5 shadow-[var(--shadow-card)]">
						<div className="space-y-4 rounded-[1.5rem] bg-muted/40 p-5">
							<p className="text-sm font-medium text-muted-foreground">Data model</p>
							<h2 className="text-2xl font-semibold">Your browser first. Your services if enabled.</h2>
							<ul className="space-y-3 text-sm leading-6 text-muted-foreground">
								{privacyPoints.map((point) => (
									<li key={point} className="flex gap-3">
										<span
											aria-hidden="true"
											className="mt-2 size-2 rounded-full bg-primary"
										/>
										<span>{point}</span>
									</li>
								))}
							</ul>
						</div>
					</aside>
				</section>

				<section className="border-y border-border/70 bg-muted/25">
					<div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
						{features.map((feature) => (
							<article
								key={feature.title}
								className="rounded-2xl border border-border/70 bg-card p-5 shadow-[var(--shadow-card)]">
								<h2 className="text-base font-semibold">{feature.title}</h2>
								<p className="mt-3 text-sm leading-6 text-muted-foreground">
									{feature.description}
								</p>
							</article>
						))}
					</div>
				</section>

				<section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-12 sm:px-6 lg:grid-cols-2">
					<div className="rounded-3xl border border-border/70 bg-card p-6 shadow-[var(--shadow-card)]">
						<h2 className="text-2xl font-semibold">Optional sync is user-owned</h2>
						<p className="mt-3 leading-7 text-muted-foreground">
							MizanTrack does not provide a developer-operated finance database. If you enable sync,
							you paste configuration for your own Firebase project. If you enable Google Sheets
							backup, the app writes backup spreadsheets to your own Google Drive using only the
							Drive file permission for files the app creates.
						</p>
					</div>
					<div className="rounded-3xl border border-border/70 bg-card p-6 shadow-[var(--shadow-card)]">
						<h2 className="text-2xl font-semibold">Built for everyday review</h2>
						<p className="mt-3 leading-7 text-muted-foreground">
							Use MizanTrack to understand cash flow, inspect categories, manage budgets, record gold
							holdings, and estimate zakat obligations. You remain responsible for checking the data
							and making financial or religious decisions.
						</p>
					</div>
				</section>
			</main>
		</PublicPageFrame>
	);
}
