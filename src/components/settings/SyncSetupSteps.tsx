"use client";

import { SyncConfigTemplate } from "@/components/settings/SyncConfigTemplate";
import { SyncValidationFeedback } from "@/components/settings/SyncValidationFeedback";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { ParseFirebaseConfigResult } from "@/lib/firebaseConfigParser";

interface SyncSetupStepsProps {
	activeStep: number;
	pastedJson: string;
	onPastedJsonChange: (value: string) => void;
	parseResult: ParseFirebaseConfigResult | null;
	onOpenWizardAtStep: (step: number) => void;
}

function Step0Content() {
	return (
		<div className="space-y-3">
			<p>
				Go to{" "}
				<a
					href="https://console.firebase.google.com"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline underline-offset-2">
					console.firebase.google.com
				</a>{" "}
				and sign in with your Google account.
			</p>
			<p>
				Click <strong>Add project</strong> and give it any name — for example{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">mizantrack-backup</code>. You can
				disable Google Analytics when prompted; it is not needed.
			</p>
			<p>
				Wait for the project to be created, then click <strong>Continue</strong>.
			</p>
		</div>
	);
}

function Step1Content() {
	return (
		<div className="space-y-3">
			<p>
				Inside your project, click the <strong>⚙️ gear icon</strong> next to{" "}
				<em>Project Overview</em> in the left sidebar, then choose <strong>Project settings</strong>
				.
			</p>
			<p>
				Scroll down to <strong>Your apps</strong>. Click the{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">&lt;/&gt;</code> icon (Web) to
				register a new web app.
			</p>
			<p>
				Give the app a nickname — for example{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">MizanTrack</code>. Leave{" "}
				<em>Firebase Hosting</em> unchecked. Click <strong>Register app</strong>.
			</p>
		</div>
	);
}

function Step2Content() {
	return (
		<div className="space-y-3">
			<p>
				After registering the app, Firebase shows you an SDK snippet. Make sure{" "}
				<strong>Config</strong> is selected (not CDN).
			</p>
			<p>
				Copy the entire <code className="rounded bg-muted px-1 py-0.5 text-xs">firebaseConfig</code>{" "}
				object — from the opening{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">{"{"}</code> to the closing{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">{"}"}</code>.
			</p>
			<p>
				The object will contain keys like{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">apiKey</code>,{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">authDomain</code>, and{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">projectId</code>. Use the template
				below as a reference.
			</p>
			<SyncConfigTemplate />
		</div>
	);
}

function Step4Content() {
	return (
		<div className="space-y-3">
			<div className="space-y-1.5 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
				<p className="font-medium text-foreground">🔒 Your privacy is protected</p>
				<p>
					MizanTrack never stores or transmits your Firebase config. It is saved only in your
					browser&apos;s local storage (IndexedDB) on this device.
				</p>
				<p>
					Your financial data syncs directly between your browser and your own Firebase project.
					MizanTrack&apos;s servers are never involved.
				</p>
			</div>
			<div className="space-y-1.5">
				<p className="text-sm font-medium">Before you apply:</p>
				<ul className="list-inside list-disc space-y-1 text-sm">
					<li>Your Firebase project has been created ✓</li>
					<li>A web app has been registered ✓</li>
					<li>The config JSON has been pasted and validated ✓</li>
					<li>Firestore security rules are set (see below) ✓</li>
				</ul>
			</div>
			<div className="space-y-1">
				<p className="text-xs font-medium text-foreground">Required Firestore Security Rules</p>
				<p className="text-xs">
					In your Firebase project → <strong>Firestore Database</strong> → <strong>Rules</strong>,
					paste:
				</p>
				<pre className="overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs leading-relaxed">
					{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{document=**} {
      allow read, write: if true;
    }
  }
}`}
				</pre>
				<p className="text-xs">
					This is safe because your data lives in <em>your own private Firebase project</em> — no
					one else has access to it.
				</p>
			</div>
			<p className="text-sm">
				Click <strong>Apply Config</strong> to pre-fill the config field. You can then review it and
				tap <strong>Save Config</strong> to activate sync.
			</p>
		</div>
	);
}

export function SyncSetupSteps({
	activeStep,
	pastedJson,
	onPastedJsonChange,
	parseResult,
	onOpenWizardAtStep,
}: SyncSetupStepsProps) {
	const steps = [
		{ title: "Open Firebase Console", icon: "🌐", content: <Step0Content /> },
		{ title: "Create a Web App", icon: "📱", content: <Step1Content /> },
		{ title: "Copy the SDK Config", icon: "📋", content: <Step2Content /> },
		{ title: "Paste Your Config", icon: "📝", content: null },
		{ title: "Privacy & Confirm", icon: "🔒", content: <Step4Content /> },
	];

	const step = steps[activeStep];

	return (
		<div className="flex flex-col gap-4 py-2">
			<div className="flex items-center gap-2">
				<span className="text-xl" aria-hidden>
					{step?.icon}
				</span>
				<h3 className="text-base font-semibold">{step?.title}</h3>
			</div>

			<div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
				{activeStep === 3 ? (
					<div className="space-y-3">
						<p>Paste the config object you copied from Firebase:</p>
						<div className="space-y-1.5">
							<Label htmlFor="wizard-firebase-json">Firebase Config (JSON)</Label>
							<Textarea
								id="wizard-firebase-json"
								value={pastedJson}
								onChange={(e) => onPastedJsonChange(e.target.value)}
								placeholder={`{\n  "apiKey": "...",\n  "authDomain": "...",\n  "projectId": "..."\n}`}
								className="font-mono text-xs"
								rows={7}
								aria-describedby={
									parseResult && !parseResult.valid ? "wizard-json-errors" : undefined
								}
							/>
							{parseResult && !parseResult.valid && (
								<div id="wizard-json-errors">
									<SyncValidationFeedback
										errors={parseResult.errors}
										onOpenWizardAtStep={onOpenWizardAtStep}
									/>
								</div>
							)}
							{parseResult?.valid && (
								<p className="text-xs text-emerald-600 dark:text-emerald-400">
									✓ Config looks good — click Next to continue.
								</p>
							)}
						</div>
						<SyncConfigTemplate />
					</div>
				) : (
					step?.content
				)}
			</div>
		</div>
	);
}
