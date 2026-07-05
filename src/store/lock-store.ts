import { create } from "zustand";

interface LockStore {
	isLocked: boolean;
	failedAttempts: number;
	/** Unix ms timestamp after which PIN entry re-enables. null = no lockout. */
	lockoutUntil: number | null;
	/** Internal: setTimeout handle for the grace timer. */
	_graceTimerHandle: ReturnType<typeof setTimeout> | null;
	/** Whether the grace timer has expired (set to true when timer fires). */
	_graceExpired: boolean;

	lock: () => void;
	unlock: () => void;
	recordFailedAttempt: () => void;
	resetAttempts: () => void;
	startGraceTimer: (ms: number) => void;
	cancelGraceTimer: () => void;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30_000;

export const useLockStore = create<LockStore>((set, get) => ({
	isLocked: false,
	failedAttempts: 0,
	lockoutUntil: null,
	_graceTimerHandle: null,
	_graceExpired: false,

	lock: () => set({ isLocked: true }),
	unlock: () => set({ isLocked: false }),

	recordFailedAttempt: () => {
		const next = get().failedAttempts + 1;
		if (next >= MAX_ATTEMPTS) {
			set({
				failedAttempts: next,
				lockoutUntil: Date.now() + LOCKOUT_DURATION_MS,
			});
		} else {
			set({ failedAttempts: next });
		}
	},

	resetAttempts: () => set({ failedAttempts: 0, lockoutUntil: null }),

	startGraceTimer: (ms: number) => {
		// Cancel any existing timer first
		const existing = get()._graceTimerHandle;
		if (existing !== null) clearTimeout(existing);

		set({ _graceExpired: false });
		const handle = setTimeout(() => {
			set({ _graceExpired: true, _graceTimerHandle: null });
		}, ms);
		set({ _graceTimerHandle: handle });
	},

	cancelGraceTimer: () => {
		const handle = get()._graceTimerHandle;
		if (handle !== null) clearTimeout(handle);
		set({ _graceTimerHandle: null, _graceExpired: false });
	},
}));
