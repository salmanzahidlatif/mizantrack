import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { useLockStore } from "@/store/lock-store";

beforeEach(() => {
	// Reset store state between tests
	const store = useLockStore.getState();
	store.cancelGraceTimer();
	useLockStore.setState({
		isLocked: false,
		failedAttempts: 0,
		lockoutUntil: null,
		_graceTimerHandle: null,
		_graceExpired: false,
	});
	vi.useRealTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("lock-store", () => {
	it("lock_setsIsLockedTrue", () => {
		useLockStore.getState().lock();
		expect(useLockStore.getState().isLocked).toBe(true);
	});

	it("unlock_setsIsLockedFalse", () => {
		useLockStore.getState().lock();
		useLockStore.getState().unlock();
		expect(useLockStore.getState().isLocked).toBe(false);
	});

	it("recordFailedAttempt_incrementsCounter", () => {
		useLockStore.getState().recordFailedAttempt();
		useLockStore.getState().recordFailedAttempt();
		expect(useLockStore.getState().failedAttempts).toBe(2);
	});

	it("recordFailedAttempt_4thAttemptDoesNotSetLockout", () => {
		for (let i = 0; i < 4; i++) useLockStore.getState().recordFailedAttempt();
		expect(useLockStore.getState().lockoutUntil).toBeNull();
	});

	it("recordFailedAttempt_5thAttemptSetsLockout", () => {
		const before = Date.now();
		for (let i = 0; i < 5; i++) useLockStore.getState().recordFailedAttempt();
		const { lockoutUntil } = useLockStore.getState();
		expect(lockoutUntil).not.toBeNull();
		expect(lockoutUntil!).toBeGreaterThanOrEqual(before + 29_000);
	});

	it("resetAttempts_clearsCounterAndLockout", () => {
		for (let i = 0; i < 5; i++) useLockStore.getState().recordFailedAttempt();
		useLockStore.getState().resetAttempts();
		const { failedAttempts, lockoutUntil } = useLockStore.getState();
		expect(failedAttempts).toBe(0);
		expect(lockoutUntil).toBeNull();
	});

	it("startGraceTimer_setsGraceExpiredAfterDelay", async () => {
		vi.useFakeTimers();
		useLockStore.getState().startGraceTimer(100);
		expect(useLockStore.getState()._graceExpired).toBe(false);
		vi.advanceTimersByTime(101);
		expect(useLockStore.getState()._graceExpired).toBe(true);
	});

	it("cancelGraceTimer_preventsGraceExpiry", async () => {
		vi.useFakeTimers();
		useLockStore.getState().startGraceTimer(100);
		useLockStore.getState().cancelGraceTimer();
		vi.advanceTimersByTime(200);
		expect(useLockStore.getState()._graceExpired).toBe(false);
	});

	it("startGraceTimer_replacesExistingTimer", () => {
		vi.useFakeTimers();
		useLockStore.getState().startGraceTimer(1000);
		useLockStore.getState().startGraceTimer(100);
		vi.advanceTimersByTime(150);
		expect(useLockStore.getState()._graceExpired).toBe(true);
	});
});
