"use client";

import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useHaptics } from "@/hooks/useHaptics";
import { useHideAmounts } from "@/hooks/useHideAmounts";
import { upsertDbConfig } from "@/lib/db/dbConfig";
import { usePrivacyStore } from "@/store/privacy-store";

interface HideAmountsToggleProps {
	userId: string;
	className?: string;
}

/** Masks or reveals every monetary amount app-wide. Persisted in dbConfig. */
export function HideAmountsToggle({ userId, className }: HideAmountsToggleProps) {
	const hideAmounts = useHideAmounts();
	const haptics = useHaptics();

	function handleToggle() {
		const next = !hideAmounts;
		usePrivacyStore.getState().setHideAmounts(next);
		haptics.selection();
		void upsertDbConfig(userId, { hideAmounts: next });
	}

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className={className}
			data-testid="hide-amounts-toggle"
			aria-pressed={hideAmounts}
			aria-label={hideAmounts ? "Show amounts" : "Hide amounts"}
			title={hideAmounts ? "Show amounts" : "Hide amounts"}
			onClick={handleToggle}>
			{hideAmounts ? (
				<EyeOff className="h-4 w-4" aria-hidden="true" />
			) : (
				<Eye className="h-4 w-4" aria-hidden="true" />
			)}
		</Button>
	);
}
