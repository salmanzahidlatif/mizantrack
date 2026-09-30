export interface AnalyticsChunkOptions {
	batchSize?: number;
	yieldNow?: () => Promise<void>;
	onYield?: () => void;
}

const DEFAULT_BATCH_SIZE = 500;

interface SchedulerLike {
	postTask?: (
		callback: () => void,
		options?: { priority?: "background" | "user-visible" }
	) => Promise<void>;
}

interface IdleDeadlineLike {
	didTimeout: boolean;
	timeRemaining: () => number;
}

type RequestIdleCallbackLike = (
	callback: (deadline: IdleDeadlineLike) => void,
	options?: { timeout?: number }
) => number;

function getGlobalWithSchedulers(): typeof globalThis & {
	scheduler?: SchedulerLike;
	requestIdleCallback?: RequestIdleCallbackLike;
} {
	return globalThis as typeof globalThis & {
		scheduler?: SchedulerLike;
		requestIdleCallback?: RequestIdleCallbackLike;
	};
}

export async function yieldToMainThread(): Promise<void> {
	const scheduler = getGlobalWithSchedulers().scheduler;
	if (scheduler?.postTask) {
		await scheduler.postTask(() => undefined, { priority: "user-visible" });
		return;
	}

	const requestIdleCallback = getGlobalWithSchedulers().requestIdleCallback;
	if (requestIdleCallback) {
		await new Promise<void>((resolve) => {
			requestIdleCallback(() => resolve(), { timeout: 16 });
		});
		return;
	}

	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
}

export async function yieldAfterChunk(
	processed: number,
	options: AnalyticsChunkOptions | undefined,
	defaultBatchSize = DEFAULT_BATCH_SIZE
): Promise<void> {
	const batchSize = Math.max(1, Math.floor(options?.batchSize ?? defaultBatchSize));
	if (processed === 0 || processed % batchSize !== 0) return;

	options?.onYield?.();
	await (options?.yieldNow ?? yieldToMainThread)();
}
