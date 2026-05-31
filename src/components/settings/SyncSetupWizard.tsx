"use client";

import { useEffect, useState } from "react";

import { SyncSetupSteps } from "@/components/settings/SyncSetupSteps";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { parseFirebaseConfigJson } from "@/lib/firebaseConfigParser";
import { cn } from "@/lib/utils";

import type { ParseFirebaseConfigResult } from "@/lib/firebaseConfigParser";

const STEP_COUNT = 6;

interface SyncSetupWizardProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialStep?: number;
	onConfigPasted: (json: string) => void;
}

export function SyncSetupWizard({
	open,
	onOpenChange,
	initialStep,
	onConfigPasted,
}: SyncSetupWizardProps) {
	const [activeStep, setActiveStep] = useState(0);
	const [pastedJson, setPastedJson] = useState("");
	const [parseResult, setParseResult] = useState<ParseFirebaseConfigResult | null>(null);

	useEffect(() => {
		if (open) {
			setActiveStep(initialStep ?? 0);
		}
	}, [open, initialStep]);

	function handlePastedJsonChange(value: string) {
		setPastedJson(value);
		setParseResult(parseFirebaseConfigJson(value));
	}

	function handleConfirm() {
		if (parseResult?.valid) {
			onConfigPasted(pastedJson);
			onOpenChange(false);
		}
	}

	const isNextDisabled = activeStep === 4 && parseResult?.valid !== true;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
				<SheetHeader>
					<SheetTitle>Cloud Sync Setup</SheetTitle>
					<SheetDescription>
						Step {activeStep + 1} of {STEP_COUNT}
					</SheetDescription>
				</SheetHeader>

				{/* Step progress bar */}
				<div className="flex gap-1.5 px-6" role="tablist" aria-label="Setup steps">
					{Array.from({ length: STEP_COUNT }).map((_, i) => (
						<div
							key={i}
							role="tab"
							aria-selected={i === activeStep}
							aria-label={`Step ${i + 1}`}
							className={cn(
								"h-1.5 flex-1 rounded-full transition-colors",
								i <= activeStep ? "bg-primary" : "bg-muted"
							)}
						/>
					))}
				</div>

				{/* Scrollable step content */}
				<ScrollArea className="flex-1 px-6">
					<SyncSetupSteps
						activeStep={activeStep}
						pastedJson={pastedJson}
						onPastedJsonChange={handlePastedJsonChange}
						parseResult={parseResult}
						onOpenWizardAtStep={setActiveStep}
					/>
				</ScrollArea>

				{/* Navigation footer */}
				<SheetFooter className="flex justify-between px-6 pb-6">
					<Button
						variant="outline"
						disabled={activeStep === 0}
						onClick={() => setActiveStep((s) => s - 1)}>
						Back
					</Button>
					{activeStep < STEP_COUNT - 1 ? (
						<Button disabled={isNextDisabled} onClick={() => setActiveStep((s) => s + 1)}>
							Next
						</Button>
					) : (
						<Button onClick={handleConfirm}>Apply Config</Button>
					)}
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
