"use client";

import { ArrowDownToLine, PencilLine, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
	clearZakatPastRemainingOverride,
	saveZakatPastRemainingOverride,
} from "@/lib/zakatYearRepository";

import type { ZakatCarryForward } from "@/lib/zakatCarryForward";
import type { ZakatAssessment } from "@/lib/zakatEngine";

/**
 * An amount still owed and an amount overpaid read identically as bare numbers, so each
 * settlement state gets its own label and colour rather than a bare signed figure.
 */
const SETTLEMENT_STYLES = {
	balance: {
		label: "Balance — still to pay",
		container: "border-destructive/40 bg-destructive/5",
		amount: "text-destructive",
	},
	excess: {
		label: "Excess — overpaid, carries to next year",
		container: "border-primary bg-primary/5",
		amount: "text-primary",
	},
	settled: {
		label: "Settled in full",
		container: "border-border bg-card",
		amount: "text-foreground",
	},
} as const;

interface ZakatCarryForwardControlProps {
	userId: string;
	islamicYear: number;
	/** Label for the sheet this year maps to, e.g. "2024 (1444–1445)". */
	yearLabel: string;
	currency: string;
	carryForward: ZakatCarryForward;
	assessment: ZakatAssessment;
}

function formatInputAmount(amount: number): string {
	if (!Number.isFinite(amount) || amount === 0) return "";
	return String(Number(amount.toFixed(4)));
}

/**
 * Past Remaining for one zakat year: where it came from, what it does to Total To Pay,
 * and a way to type a different figure before the year is finalised.
 *
 * Only the typed figure is ever saved. Clearing it puts the year back on the balance
 * carried from the year before, which is recomputed every time it is shown.
 */
export function ZakatCarryForwardControl({
	userId,
	islamicYear,
	yearLabel,
	currency,
	carryForward,
	assessment,
}: ZakatCarryForwardControlProps) {
	const [draft, setDraft] = useState(() => formatInputAmount(carryForward.pastRemaining));
	const [saving, setSaving] = useState(false);
	const isManual = carryForward.source === "manual";
	const settlement =
		assessment.balanceOrExcess < 0
			? ("excess" as const)
			: assessment.balanceOrExcess > 0
				? ("balance" as const)
				: ("settled" as const);

	useEffect(() => {
		setDraft(formatInputAmount(carryForward.pastRemaining));
	}, [carryForward.pastRemaining, islamicYear]);

	const parsedDraft = draft.trim() === "" ? 0 : Number(draft);
	const isDraftValid = Number.isFinite(parsedDraft);
	const isDirty = isDraftValid && parsedDraft !== carryForward.pastRemaining;

	async function handleSave() {
		if (!isDraftValid) {
			toast.error("Past Remaining must be a number.");
			return;
		}

		setSaving(true);
		try {
			await saveZakatPastRemainingOverride({
				userId,
				islamicYear,
				pastRemaining: parsedDraft,
			});
			toast.success(`Past Remaining for ${yearLabel} set by hand.`);
		} catch (error) {
			console.error("Failed to save the Past Remaining override", error);
			toast.error("Could not save Past Remaining.");
		} finally {
			setSaving(false);
		}
	}

	async function handleReset() {
		setSaving(true);
		try {
			await clearZakatPastRemainingOverride(userId, islamicYear);
			toast.success(`Past Remaining for ${yearLabel} carried from the previous year again.`);
		} catch (error) {
			console.error("Failed to reset the Past Remaining override", error);
			toast.error("Could not reset Past Remaining.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className={cn(CARD_SURFACE, "space-y-3 p-4")}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h3 className="text-sm font-medium">Past Remaining</h3>
					<p className="text-xs text-muted-foreground">
						{isManual
							? "Set by you for this year."
							: carryForward.carriedFromIslamicYear !== undefined
								? `Carried from the ${carryForward.carriedFromIslamicYear}–${carryForward.carriedFromIslamicYear + 1} Balance/Excess.`
								: "Nothing to carry — this is the first year on record."}
					</p>
				</div>
				<Badge variant={isManual ? "secondary" : "outline"}>
					{isManual ? (
						<PencilLine className="mr-1 h-3 w-3" />
					) : (
						<ArrowDownToLine className="mr-1 h-3 w-3" />
					)}
					{isManual ? "Manual" : "Carried forward"}
				</Badge>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="zakat-past-remaining">Past Remaining ({currency})</Label>
				<div className="flex items-center gap-2">
					<Input
						id="zakat-past-remaining"
						type="number"
						step="any"
						inputMode="decimal"
						disabled={saving}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder="0.00"
						className="w-full"
					/>
					<Button variant="outline" disabled={saving || !isDirty} onClick={() => void handleSave()}>
						Save
					</Button>
					{isManual && (
						<Button
							variant="ghost"
							size="icon"
							disabled={saving}
							aria-label="Reset to the carried value"
							onClick={() => void handleReset()}>
							<RotateCcw className="h-4 w-4" />
						</Button>
					)}
				</div>
				{isManual && (
					<p className="text-xs text-muted-foreground">
						Carried value was{" "}
						<CurrencyAmount
							amount={carryForward.automatic}
							currency={currency}
							showNegativeSign
							className="font-medium"
						/>
						.
					</p>
				)}
				<p className="text-xs text-muted-foreground">
					A negative figure is last year&apos;s overpayment, carried as a credit against this year.
				</p>
			</div>

			<dl className="space-y-1.5 border-t pt-3 text-sm">
				{[
					{ label: "Zakat this year", amount: assessment.zakatObligation },
					{ label: "Past Remaining", amount: assessment.pastRemaining },
					{ label: "Total To Pay", amount: assessment.totalToPay, emphasised: true },
					{ label: "Paid", amount: assessment.paid },
				].map(({ label, amount, emphasised }) => (
					<div key={label} className="flex justify-between">
						<dt className="text-muted-foreground">{label}</dt>
						<dd className={cn("tabular-nums", emphasised ? "font-semibold" : "font-medium")}>
							<CurrencyAmount
								amount={amount}
								currency={currency}
								showNegativeSign
								className={emphasised ? "font-semibold" : "font-medium"}
							/>
						</dd>
					</div>
				))}
			</dl>

			<div
				className={cn(
					"rounded-lg border-2 p-3 text-center",
					SETTLEMENT_STYLES[settlement].container
				)}>
				<p className="text-xs text-muted-foreground">{SETTLEMENT_STYLES[settlement].label}</p>
				<p
					className={cn(
						"mt-1 text-xl font-bold tabular-nums",
						SETTLEMENT_STYLES[settlement].amount
					)}>
					<CurrencyAmount
						amount={Math.abs(assessment.balanceOrExcess)}
						currency={currency}
						className={cn("text-xl font-bold", SETTLEMENT_STYLES[settlement].amount)}
					/>
				</p>
			</div>
		</div>
	);
}
