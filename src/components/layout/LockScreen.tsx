"use client";

import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useDbConfig } from "@/hooks/useDbConfig";
import { authenticateBiometric, isBiometricAvailable } from "@/lib/webAuthn";
import { verifyPin } from "@/lib/pinCrypto";
import { useLockStore } from "@/store/lock-store";

const PIN_LENGTH = 4;

interface LockScreenProps {
	userId: string;
	onUnlock: () => void;
}

export function LockScreen({ userId, onUnlock }: LockScreenProps) {
	const config = useDbConfig(userId);
	const { failedAttempts, lockoutUntil, recordFailedAttempt, resetAttempts } = useLockStore();

	const [digits, setDigits] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [countdown, setCountdown] = useState(0);
	const [showForgotPin, setShowForgotPin] = useState(false);

	// Countdown timer for lockout
	useEffect(() => {
		if (!lockoutUntil) return;
		const tick = () => {
			const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
			if (remaining <= 0) {
				resetAttempts();
				setCountdown(0);
			} else {
				setCountdown(remaining);
			}
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [lockoutUntil, resetAttempts]);

	// Auto-trigger biometric on mount if enrolled
	useEffect(() => {
		if (
			config?.biometricEnabled &&
			config?.biometricCredentialId &&
			isBiometricAvailable()
		) {
			void tryBiometric();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const tryBiometric = async () => {
		if (!config?.biometricCredentialId) return;
		try {
			const ok = await authenticateBiometric(config.biometricCredentialId);
			if (ok) {
				resetAttempts();
				onUnlock();
			}
		} catch {
			// Biometric failed — fall back to PIN silently
		}
	};

	const handleDigit = useCallback(
		async (d: string) => {
			if (lockoutUntil && Date.now() < lockoutUntil) return;
			const next = [...digits, d];
			setDigits(next);
			setError(null);

			if (next.length === PIN_LENGTH) {
				const pin = next.join("");
				const hash = config?.pinHash ?? "";
				const ok = await verifyPin(pin, hash);
				if (ok) {
					resetAttempts();
					onUnlock();
				} else {
					recordFailedAttempt();
					const remaining = 5 - (failedAttempts + 1);
					if (remaining > 0) {
						setError(`Incorrect PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`);
					}
					setDigits([]);
				}
			}
		},
		[digits, lockoutUntil, config?.pinHash, failedAttempts, recordFailedAttempt, resetAttempts, onUnlock]
	);

	const handleBackspace = () => {
		setDigits((prev) => prev.slice(0, -1));
		setError(null);
	};

	const isLockedOut = lockoutUntil !== null && Date.now() < lockoutUntil;

	if (showForgotPin) {
		return <ForgotPinSheet userId={userId} onDone={onUnlock} onBack={() => setShowForgotPin(false)} />;
	}

	return (
		<div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background px-6">
			{/* Logo + title */}
			<div className="mb-8 flex flex-col items-center gap-2">
				<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
					<KeyRound className="h-7 w-7 text-primary-foreground" />
				</div>
				<h1 className="text-xl font-semibold">MizanTrack</h1>
				<p className="text-sm text-muted-foreground">Enter your PIN to continue</p>
			</div>

			{/* PIN dots */}
			<div className="mb-6 flex gap-4">
				{Array.from({ length: PIN_LENGTH }).map((_, i) => (
					<div
						key={i}
						className={`h-4 w-4 rounded-full border-2 transition-colors ${
							i < digits.length
								? "border-primary bg-primary"
								: "border-muted-foreground bg-transparent"
						}`}
					/>
				))}
			</div>

			{/* Error / lockout message */}
			{isLockedOut ? (
				<p className="mb-4 text-sm font-medium text-destructive">
					Too many attempts. Try again in {countdown}s.
				</p>
			) : error ? (
				<p className="mb-4 text-sm text-destructive">{error}</p>
			) : (
				<div className="mb-4 h-5" />
			)}

			{/* Numeric pad */}
			<div className="grid w-full max-w-[280px] grid-cols-3 gap-3">
				{["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
					<button
						key={d}
						onClick={() => void handleDigit(d)}
						disabled={isLockedOut}
						className="flex h-16 w-full items-center justify-center rounded-2xl border border-border bg-card text-2xl font-medium transition-colors active:bg-muted disabled:opacity-40 touch-manipulation"
					>
						{d}
					</button>
				))}
				{/* Biometric button (bottom-left) */}
				<button
					onClick={() => void tryBiometric()}
					disabled={isLockedOut || !config?.biometricEnabled || !isBiometricAvailable()}
					className="flex h-16 w-full items-center justify-center rounded-2xl border border-border bg-card text-xs text-muted-foreground transition-colors active:bg-muted disabled:invisible touch-manipulation"
					aria-label="Use biometric"
				>
					{/* Face ID / fingerprint icon placeholder */}
					<span className="text-xl">🔑</span>
				</button>
				<button
					onClick={() => void handleDigit("0")}
					disabled={isLockedOut}
					className="flex h-16 w-full items-center justify-center rounded-2xl border border-border bg-card text-2xl font-medium transition-colors active:bg-muted disabled:opacity-40 touch-manipulation"
				>
					0
				</button>
				{/* Backspace */}
				<button
					onClick={handleBackspace}
					disabled={isLockedOut || digits.length === 0}
					className="flex h-16 w-full items-center justify-center rounded-2xl border border-border bg-card text-xl text-muted-foreground transition-colors active:bg-muted disabled:opacity-40 touch-manipulation"
					aria-label="Backspace"
				>
					⌫
				</button>
			</div>

			{/* Forgot PIN */}
			<button
				onClick={() => setShowForgotPin(true)}
				className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:underline touch-manipulation"
			>
				Forgot PIN?
			</button>
		</div>
	);
}

// ── Forgot PIN inline sheet ──────────────────────────────────────────────────

interface ForgotPinSheetProps {
	userId: string;
	onDone: () => void;
	onBack: () => void;
}

function ForgotPinSheet({ userId, onDone, onBack }: ForgotPinSheetProps) {
	const config = useDbConfig(userId);
	const [step, setStep] = useState<"reauth" | "newpin" | "confirm">("reauth");
	const [newPin, setNewPin] = useState("");
	const [confirmPin, setConfirmPin] = useState("");
	const [pinError, setPinError] = useState<string | null>(null);

	const handleGoogleReauth = async () => {
		// Use next-auth/react signIn which handles redirect
		const { signIn } = await import("next-auth/react");
		await signIn("google", { redirect: false });
		setStep("newpin");
	};

	const handleBiometricReauth = async () => {
		if (!config?.biometricCredentialId) return;
		try {
			const ok = await authenticateBiometric(config.biometricCredentialId);
			if (ok) setStep("newpin");
		} catch {
			setPinError("Biometric failed. Use Google instead.");
		}
	};

	const handleSavePin = async () => {
		if (newPin.length !== PIN_LENGTH) return;
		if (newPin !== confirmPin) {
			setPinError("PINs don't match. Try again.");
			setConfirmPin("");
			return;
		}
		const { hashPin } = await import("@/lib/pinCrypto");
		const { db } = await import("@/lib/db/local");
		const hash = await hashPin(newPin);
		await db.dbConfig.update(userId, { pinHash: hash, appLockEnabled: true });
		useLockStore.getState().resetAttempts();
		onDone();
	};

	const canUseBiometric =
		config?.biometricEnabled &&
		config?.biometricCredentialId &&
		isBiometricAvailable();

	return (
		<div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background px-6">
			<div className="w-full max-w-sm space-y-6">
				<div>
					<h2 className="text-lg font-semibold">Reset PIN</h2>
					<p className="text-sm text-muted-foreground">
						{step === "reauth"
							? "Re-authenticate to set a new PIN. Your data will not be deleted."
							: step === "newpin"
								? "Enter your new 4-digit PIN."
								: "Confirm your new PIN."}
					</p>
				</div>

				{pinError && <p className="text-sm text-destructive">{pinError}</p>}

				{step === "reauth" && (
					<div className="flex flex-col gap-3">
						{canUseBiometric && (
							<Button onClick={() => void handleBiometricReauth()} className="w-full">
								Use Face ID / Fingerprint
							</Button>
						)}
						<Button variant="outline" onClick={() => void handleGoogleReauth()} className="w-full">
							Continue with Google
						</Button>
					</div>
				)}

				{(step === "newpin" || step === "confirm") && (
					<div className="space-y-4">
						<input
							type="password"
							inputMode="numeric"
							maxLength={PIN_LENGTH}
							placeholder={step === "newpin" ? "New PIN" : "Confirm PIN"}
							value={step === "newpin" ? newPin : confirmPin}
							onChange={(e) => {
								const val = e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
								if (step === "newpin") setNewPin(val);
								else setConfirmPin(val);
								setPinError(null);
							}}
							className="w-full rounded-lg border border-border bg-background px-4 py-3 text-center text-2xl tracking-[1rem] focus:outline-none focus:ring-2 focus:ring-ring"
						/>
						{step === "newpin" ? (
							<Button
								onClick={() => { if (newPin.length === PIN_LENGTH) setStep("confirm"); }}
								disabled={newPin.length !== PIN_LENGTH}
								className="w-full"
							>
								Next
							</Button>
						) : (
							<Button
								onClick={() => void handleSavePin()}
								disabled={confirmPin.length !== PIN_LENGTH}
								className="w-full"
							>
								Save New PIN
							</Button>
						)}
					</div>
				)}

				<button onClick={onBack} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
					← Back to PIN entry
				</button>
			</div>
		</div>
	);
}
