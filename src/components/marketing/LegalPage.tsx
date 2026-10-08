import { PublicPageFrame } from "@/components/marketing/PublicChrome";

import type { ReactNode } from "react";

interface LegalSection {
	title: string;
	body: ReactNode;
}

export function LegalPage({
	title,
	description,
	lastUpdated,
	sections,
}: {
	title: string;
	description: string;
	lastUpdated: string;
	sections: LegalSection[];
}) {
	return (
		<PublicPageFrame>
			<main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
				<div className="space-y-3 border-b border-border/70 pb-8">
					<p className="text-sm font-medium text-muted-foreground">Last updated: {lastUpdated}</p>
					<h1 className="text-4xl font-semibold tracking-tight text-balance">{title}</h1>
					<p className="max-w-3xl text-base leading-7 text-muted-foreground">{description}</p>
				</div>
				<div className="space-y-9 py-8">
					{sections.map((section) => (
						<section key={section.title} className="space-y-3">
							<h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
							<div className="space-y-3 leading-7 text-muted-foreground">{section.body}</div>
						</section>
					))}
				</div>
			</main>
		</PublicPageFrame>
	);
}
