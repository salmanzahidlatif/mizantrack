"use client";

import { useEffect } from "react";

import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function ErrorPage({
	error,
	unstable_retry,
}: {
	error: Error & { digest?: string };
	unstable_retry: () => void;
}) {
	useEffect(() => {
		console.error("App route error:", error);
	}, [error]);

	return (
		<ErrorBoundary
			message={error.message || "The current screen crashed. Try again or reload the app."}
			digest={error.digest}
			onRetry={unstable_retry}
		/>
	);
}
