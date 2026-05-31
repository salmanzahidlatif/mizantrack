"use client";

import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { FieldError } from "@/lib/firebaseConfigParser";

interface SyncValidationFeedbackProps {
	errors: FieldError[];
	onOpenWizardAtStep: (step: number) => void;
}

export function SyncValidationFeedback({
	errors,
	onOpenWizardAtStep,
}: SyncValidationFeedbackProps) {
	return (
		<div role="alert" aria-live="polite" className="space-y-1">
			<ul className="space-y-1">
				{errors.map((err) => (
					<li key={err.field} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
						<AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
						<span className="text-destructive">{err.message}</span>
						<Button
							variant="link"
							size="sm"
							className="h-auto p-0 text-xs"
							onClick={() => onOpenWizardAtStep(err.wizardStep)}>
							Go to Step {err.wizardStep + 1} →
						</Button>
					</li>
				))}
			</ul>
		</div>
	);
}
