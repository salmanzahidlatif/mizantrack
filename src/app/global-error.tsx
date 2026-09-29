"use client";

import { useEffect } from "react";

import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function GlobalError({
	error,
	unstable_retry,
}: {
	error: Error & { digest?: string };
	unstable_retry: () => void;
}) {
	useEffect(() => {
		console.error("Global app error:", error);
	}, [error]);

	return (
		<html lang="en">
			<body>
				<ErrorBoundary
					title="MizanTrack recovered from a crash"
					message={error.message || "Reload the app if retrying does not recover the screen."}
					digest={error.digest}
					onRetry={unstable_retry}
				/>
			</body>
		</html>
	);
}
