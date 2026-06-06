"use client";

export default function OfflinePage() {
	return (
		<html lang="en">
			<body
				style={{
					margin: 0,
					minHeight: "100dvh",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					flexDirection: "column",
					gap: "16px",
					background: "#09090b",
					color: "#fafafa",
					fontFamily: "system-ui, sans-serif",
					textAlign: "center",
					padding: "24px",
				}}>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src="/icon-192.png" alt="MizanTrack" width={72} height={72} style={{ opacity: 0.8 }} />
				<h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>You&apos;re offline</h1>
				<p style={{ fontSize: "0.9rem", color: "#a1a1aa", maxWidth: "320px", margin: 0 }}>
					MizanTrack couldn&apos;t connect. Your local data is still available — reopen the app when
					you&apos;re back online.
				</p>
				<button
					onClick={() => window.location.reload()}
					style={{
						marginTop: "8px",
						padding: "10px 24px",
						background: "#3b82f6",
						color: "#fff",
						border: "none",
						borderRadius: "8px",
						fontSize: "0.9rem",
						cursor: "pointer",
					}}>
					Retry
				</button>
			</body>
		</html>
	);
}
