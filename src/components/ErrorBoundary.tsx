"use client";

interface ErrorBoundaryProps {
	title?: string;
	message?: string;
	digest?: string;
	onRetry?: () => void;
}

export function ErrorBoundary({
	title = "MizanTrack needs a quick refresh",
	message = "Something went wrong, but your local data remains on this device.",
	digest,
	onRetry,
}: ErrorBoundaryProps) {
	return (
		<div className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
			<div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
				<h1 className="text-xl font-semibold">{title}</h1>
				<p className="mt-3 text-sm text-muted-foreground">{message}</p>
				{digest && <p className="mt-2 text-xs text-muted-foreground">Error ID: {digest}</p>}
				<div className="mt-5 flex flex-col gap-2">
					{onRetry && (
						<button
							type="button"
							onClick={onRetry}
							className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
							Try again
						</button>
					)}
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="rounded-lg border border-border px-4 py-2 text-sm font-medium">
						Reload app
					</button>
				</div>
			</div>
		</div>
	);
}
