import Link from "next/link";

import { Button } from "@/components/ui/button";

import type { ReactNode } from "react";

export function PublicHeader() {
	return (
		<header className="border-b border-border/70 bg-background/95">
			<div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
				<Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
					<span className="flex size-9 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground">
						M
					</span>
					<span>MizanTrack</span>
				</Link>
				<nav aria-label="Public pages" className="flex items-center gap-2 text-sm">
					<Link
						href="/privacy"
						className="rounded-lg px-2.5 py-2 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
						Privacy
					</Link>
					<Link
						href="/terms-of-service"
						className="rounded-lg px-2.5 py-2 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
						Terms
					</Link>
					<Button asChild size="sm" className="hidden sm:inline-flex">
						<Link href="/login">Sign in</Link>
					</Button>
				</nav>
			</div>
		</header>
	);
}

export function PublicFooter() {
	return (
		<footer className="border-t border-border/70 bg-muted/30">
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
				<p>© MizanTrack. Personal finance tracking for your own data.</p>
				<div className="flex gap-4">
					<Link
						href="/privacy"
						className="rounded-md underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
						Privacy
					</Link>
					<Link
						href="/terms-of-service"
						className="rounded-md underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
						Terms of Service
					</Link>
				</div>
			</div>
		</footer>
	);
}

export function PublicPageFrame({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-dvh flex-col overflow-y-auto bg-background text-foreground">
			<PublicHeader />
			{children}
			<PublicFooter />
		</div>
	);
}
