"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { GOOGLE_DRIVE_FILE_SCOPE } from "@/lib/sheets/constants";

interface GoogleSheetsSetupGuideProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

function CopyableScope() {
	const [copied, setCopied] = useState(false);

	function handleCopy() {
		void navigator.clipboard.writeText(GOOGLE_DRIVE_FILE_SCOPE).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}

	return (
		<div className="rounded-md border border-border bg-muted/40 p-3">
			<div className="mb-1.5 flex items-center justify-between gap-2">
				<span className="text-xs font-medium text-muted-foreground">Scope to add</span>
				<Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopy}>
					{copied ? (
						<Check className="h-3.5 w-3.5" aria-hidden />
					) : (
						<Copy className="h-3.5 w-3.5" aria-hidden />
					)}
					{copied ? "Copied" : "Copy scope"}
				</Button>
			</div>
			<code className="block overflow-x-auto rounded bg-background px-2 py-2 font-mono text-xs break-all whitespace-pre-wrap">
				{GOOGLE_DRIVE_FILE_SCOPE}
			</code>
		</div>
	);
}

export function GoogleSheetsSetupGuide({ open, onOpenChange }: GoogleSheetsSetupGuideProps) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
				<SheetHeader>
					<SheetTitle>Google Sheets Backup Setup</SheetTitle>
					<SheetDescription>
						Follow these once in Google Cloud Console before connecting.
					</SheetDescription>
				</SheetHeader>

				<div className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-6 [-webkit-overflow-scrolling:touch]">
					<section
						aria-labelledby="google-sheets-setup-heading"
						className="min-w-0 space-y-4 py-3 pb-10 text-sm leading-relaxed [overflow-wrap:anywhere] break-words text-muted-foreground">
						<div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
							<p className="font-medium">Most common mistake</p>
							<p>
								Use the same Google Cloud project that owns this app&apos;s existing{" "}
								<code className="rounded bg-background/70 px-1 py-0.5 text-xs">AUTH_GOOGLE_ID</code>
								. If you edit a different project, Google consent will not apply to this app.
							</p>
						</div>

						<h3
							id="google-sheets-setup-heading"
							className="text-base font-semibold text-foreground">
							Setup steps
						</h3>

						<ol className="list-decimal space-y-4 pl-5">
							<li className="pl-1">
								<h4 className="font-medium text-foreground">
									Select the right Google Cloud project
								</h4>
								<p>
									Open{" "}
									<a
										href="https://console.cloud.google.com"
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
										Google Cloud Console
										<ExternalLink className="h-3 w-3" aria-hidden />
									</a>
									, then choose the project that contains the OAuth client ID used as{" "}
									<code className="rounded bg-muted px-1 py-0.5 text-xs">AUTH_GOOGLE_ID</code>.
								</p>
							</li>

							<li className="pl-1">
								<h4 className="font-medium text-foreground">Enable two APIs</h4>
								<p>
									Go to <strong>APIs &amp; Services</strong> → <strong>Library</strong>. Enable{" "}
									<strong>Google Sheets API</strong>, then enable <strong>Google Drive API</strong>.
								</p>
							</li>

							<li className="space-y-2 pl-1">
								<h4 className="font-medium text-foreground">Add only the Drive file scope</h4>
								<p>
									Go to <strong>APIs &amp; Services</strong> → <strong>OAuth consent screen</strong>
									. Google also labels this area <strong>Google Auth Platform</strong>. Open{" "}
									<strong>Data Access</strong> (formerly <strong>Scopes</strong>), tap{" "}
									<strong>ADD OR REMOVE SCOPES</strong>, filter for this scope, tick it, then tap{" "}
									<strong>UPDATE</strong> and <strong>SAVE</strong>.
								</p>
								<CopyableScope />
								<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
									<p className="font-medium">Do not add the spreadsheets scope.</p>
									<p>
										Avoid{" "}
										<code className="rounded bg-background/80 px-1 py-0.5 text-xs">
											https://www.googleapis.com/auth/spreadsheets
										</code>
										. That scope is sensitive and triggers Google&apos;s verification review.{" "}
										<code className="rounded bg-background/80 px-1 py-0.5 text-xs">drive.file</code>{" "}
										alone is enough because MizanTrack only writes spreadsheets that it creates.
										Many online guides wrongly recommend both; this app deliberately does not.
									</p>
								</div>
							</li>

							<li className="pl-1">
								<h4 className="font-medium text-foreground">
									Set Publishing status to In production
								</h4>
								<p>
									Open the <strong>Audience</strong> screen in OAuth consent / Google Auth Platform
									and set <strong>Publishing status</strong> to <strong>In production</strong>.
								</p>
								<p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 font-medium text-destructive">
									If it stays on Testing, Google expires refresh tokens every 7 days. Backups can
									then stop silently until you reconnect.
								</p>
							</li>

							<li className="pl-1">
								<h4 className="font-medium text-foreground">Connect in MizanTrack</h4>
								<p>
									Return here, tap <strong>Connect</strong>, choose your Google account, and approve
									consent once. After that, use <strong>Back up now</strong>.
								</p>
							</li>
						</ol>
					</section>
				</div>
			</SheetContent>
		</Sheet>
	);
}
