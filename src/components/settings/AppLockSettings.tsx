"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useDbConfig } from "@/hooks/useDbConfig";
import { db } from "@/lib/db/local";
import { hashPin, verifyPin } from "@/lib/pinCrypto";
import { isBiometricAvailable, registerBiometric } from "@/lib/webAuthn";

const PIN_LENGTH = 4;

interface AppLockSettingsProps {
	userId: string;
	/** User's name or email from Google, shown in the OS passkey dialog. */
	userDisplay?: string | null;
}

type PinMode = "idle" | "set" | "change-current" | "change-new" | "change-confirm";

export function AppLockSettings({ userId, userDisplay }: AppLockSettingsProps) {
	const config = useDbConfig(userId);
	const [pinMode, setPinMode] = useState<PinMode>("idle");
	const [pinInput, setPinInput] = useState("");
	const [newPin, setNewPin] = useState("");
	const [pinError, setPinError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const appLockEnabled = config?.appLockEnabled ?? false;
	const hasPin = !!config?.pinHash;
	const biometricEnabled = config?.biometricEnabled ?? false;
	const biometricAvail = isBiometricAvailable();

	const handleToggleLock = async (enabled: boolean) => {
		if (enabled && !hasPin) {
			setPinMode("set");
			return;
		}
		await db.dbConfig.update(userId, { appLockEnabled: enabled });
		toast.success(enabled ? "App Lock enabled." : "App Lock disabled.");
	};

	const handleSetPin = async () => {
		if (pinInput.length !== PIN_LENGTH) return;
		setSaving(true);
		try {
			if (pinMode === "set") {
				const hash = await hashPin(pinInput);
				await db.dbConfig.update(userId, { pinHash: hash, appLockEnabled: true });
				toast.success("PIN set. App Lock is now active.");
			} else if (pinMode === "change-new") {
				setNewPin(pinInput);
				setPinInput("");
				setPinMode("change-confirm");
				setSaving(false);
				return;
			} else if (pinMode === "change-confirm") {
				if (pinInput !== newPin) {
					setPinError("PINs don't match.");
					setPinInput("");
					setSaving(false);
					return;
				}
				const hash = await hashPin(pinInput);
				await db.dbConfig.update(userId, { pinHash: hash });
				toast.success("PIN changed successfully.");
			}
			setPinMode("idle");
			setPinInput("");
			setPinError(null);
		} finally {
			setSaving(false);
		}
	};

	const handleChangePin = async () => {
		// Verify current PIN first
		if (pinInput.length !== PIN_LENGTH) return;
		setSaving(true);
		try {
			const ok = await verifyPin(pinInput, config?.pinHash ?? "");
			if (!ok) {
				setPinError("Incorrect current PIN.");
				setPinInput("");
				setSaving(false);
				return;
			}
			setPinInput("");
			setPinError(null);
			setPinMode("change-new");
		} finally {
			setSaving(false);
		}
	};

	const handleRemovePin = async () => {
		await db.dbConfig.update(userId, {
			pinHash: undefined,
			appLockEnabled: false,
			biometricEnabled: false,
			biometricCredentialId: undefined,
		});
		toast.success("PIN removed. App Lock disabled.");
		setPinMode("idle");
	};

	const handleToggleBiometric = async (enabled: boolean) => {
		if (enabled) {
			try {
				const credentialId = await registerBiometric(userId, userDisplay ?? undefined);
				await db.dbConfig.update(userId, {
					biometricEnabled: true,
					biometricCredentialId: credentialId,
				});
				toast.success("Biometric authentication enabled.");
			} catch {
				toast.error("Biometric setup failed. Please try again.");
			}
		} else {
			await db.dbConfig.update(userId, {
				biometricEnabled: false,
				biometricCredentialId: undefined,
			});
			toast.success("Biometric authentication disabled.");
		}
	};

	const pinLabel =
		pinMode === "set"
			? "Enter a new 4-digit PIN"
			: pinMode === "change-current"
				? "Enter your current PIN"
				: pinMode === "change-new"
					? "Enter your new PIN"
					: "Confirm your new PIN";

	return (
		<div className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<h2 className="font-semibold">App Lock</h2>

			{/* Main toggle */}
			<div className="flex items-center justify-between">
				<div>
					<Label htmlFor="app-lock-toggle" className="text-sm font-medium">
						Lock screen on app return
					</Label>
					<p className="text-xs text-muted-foreground">
						Require PIN or biometric when reopening the app.
					</p>
				</div>
				<Switch
					id="app-lock-toggle"
					checked={appLockEnabled}
					onCheckedChange={(v) => void handleToggleLock(v)}
				/>
			</div>

			{/* PIN management (only when lock enabled or setting up) */}
			{(appLockEnabled || pinMode !== "idle") && (
				<div className="space-y-3 border-t border-border pt-3">
					{pinMode === "idle" && hasPin && (
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									setPinMode("change-current");
									setPinInput("");
									setPinError(null);
								}}>
								Change PIN
							</Button>
							<Button variant="outline" size="sm" onClick={() => void handleRemovePin()}>
								Remove PIN
							</Button>
						</div>
					)}

					{pinMode !== "idle" && (
						<div className="space-y-2">
							<Label>{pinLabel}</Label>
							{pinError && <p className="text-xs text-destructive">{pinError}</p>}
							<Input
								type="password"
								inputMode="numeric"
								maxLength={PIN_LENGTH}
								value={pinInput}
								onChange={(e) => {
									setPinInput(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH));
									setPinError(null);
								}}
								placeholder="••••"
								className="text-center text-2xl tracking-[1rem]"
							/>
							<div className="flex gap-2">
								<Button
									size="sm"
									disabled={pinInput.length !== PIN_LENGTH || saving}
									onClick={() =>
										pinMode === "change-current" ? void handleChangePin() : void handleSetPin()
									}>
									{saving ? "Saving…" : "Continue"}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										setPinMode("idle");
										setPinInput("");
										setPinError(null);
									}}>
									Cancel
								</Button>
							</div>
						</div>
					)}

					{/* Biometric toggle (only when PIN is set + device supports it) */}
					{hasPin && biometricAvail && pinMode === "idle" && (
						<div className="flex items-center justify-between pt-1">
							<Label htmlFor="biometric-toggle" className="text-sm">
								Use Face ID / Fingerprint
							</Label>
							<Switch
								id="biometric-toggle"
								checked={biometricEnabled}
								onCheckedChange={(v) => void handleToggleBiometric(v)}
							/>
						</div>
					)}
				</div>
			)}

			{/* Setup prompt when lock not yet configured */}
			{!appLockEnabled && pinMode === "idle" && !hasPin && (
				<div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
					<p>Set up a PIN to protect your financial data when you leave the app.</p>
					<button
						onClick={() => setPinMode("set")}
						className="mt-2 font-medium text-primary underline-offset-4 hover:underline">
						Set up App Lock →
					</button>
				</div>
			)}
		</div>
	);
}
