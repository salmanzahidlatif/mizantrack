import { LegalPage } from "@/components/marketing/LegalPage";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Privacy Policy | MizanTrack",
	description:
		"How MizanTrack stores local data, uses Google sign-in, optional Firebase sync, and optional Google Sheets backups.",
	alternates: {
		canonical: "/privacy",
	},
};

export default function PrivacyPage() {
	return (
		<LegalPage
			title="Privacy Policy"
			description="MizanTrack is a personal finance and zakat tracker designed around local storage and user-owned cloud services. This policy explains what data the app uses and where it goes."
			lastUpdated="October 8, 2026"
			sections={[
				{
					title: "What MizanTrack is",
					body: (
						<>
							<p>
								MizanTrack helps you track personal accounts, transactions, budgets, categories,
								imported Hysab Kytab records, gold holdings, zakat calculations, and zakat payments.
								It is built as an offline-first browser app. There is no central MizanTrack finance
								database operated by the developer.
							</p>
						</>
					),
				},
				{
					title: "Data stored locally in your browser",
					body: (
						<>
							<p>
								Your app data is stored in this browser using IndexedDB through Dexie. This includes
								finance records, settings, analytics cache, sync metadata, and optional security
								settings such as app-lock preferences.
							</p>
							<p>
								Google sign-in is used to identify your local records. For offline reopening, the app
								stores a local session snapshot containing your Google user id, name, email address,
								and avatar URL, plus the time it was verified.
							</p>
						</>
					),
				},
				{
					title: "Google sign-in",
					body: (
						<>
							<p>
								MizanTrack uses Google OAuth for sign-in. The basic sign-in permission identifies you
								to the app; it is not used to read your Gmail, Google Drive, contacts, or other Google
								data.
							</p>
							<p>
								The hosted app handles the OAuth callback and session needed for sign-in. It does not
								store your finance records in a developer-operated application database.
							</p>
						</>
					),
				},
				{
					title: "Optional Firebase sync",
					body: (
						<>
							<p>
								Firebase sync is optional. If you enable it, you provide configuration for a Firebase
								project that you create and own. Sync writes your records to Firestore paths under
								your user id in that project.
							</p>
							<p>
								The synced data can include accounts, categories, transactions, budgets, gold items,
								zakat calculations, zakat payments, selected preferences, and dashboard analytics.
								The app does not send that data to a shared MizanTrack Firebase project.
							</p>
							<p>
								Firebase sync deliberately does not sync your Firebase configuration JSON, GoldAPI
								key, or device-local biometric credential id. App-lock PIN data is different: when
								Firebase sync is enabled, the app-lock PIN hash and app-lock preferences are synced to
								your own Firebase project so the lock setting can follow your devices.
							</p>
						</>
					),
				},
				{
					title: "Optional Google Sheets backup",
					body: (
						<>
							<p>
								Google Sheets backup is optional and one-way. When you connect it, MizanTrack asks
								for the <code>https://www.googleapis.com/auth/drive.file</code> permission. That
								permission allows the app to create and access only files that this app creates or
								that you explicitly open with it; it does not grant access to your wider Google
								Drive.
							</p>
							<p>
								Your browser prepares the backup and writes it to spreadsheets in your Google Drive.
								The server only brokers a short-lived Google access token for this backup flow.
							</p>
							<p>
								Sheets backups exclude security-sensitive local settings: Firebase configuration,
								GoldAPI key, app-lock PIN hash, and device-local biometric credential id. The
								spreadsheet itself is not encrypted by MizanTrack, so anyone you share it with can
								read the backed-up records.
							</p>
						</>
					),
				},
				{
					title: "What the developer can and cannot see",
					body: (
						<>
							<p>
								The developer does not have a central MizanTrack server that stores your finance
								records. Records stored only in your browser are not visible to the developer.
								Records synced to Firebase are in the Firebase project you configure. Sheets backups
								are in your Google Drive.
							</p>
							<p>
								The developer could see data only if you share your browser data, Firebase project,
								Google Sheet, logs, screenshots, or similar access. Like any hosted OAuth app, the
								deployment may process sign-in and token requests needed to operate the app, but it
								is not a finance-data storage service.
							</p>
						</>
					),
				},
				{
					title: "Data deletion and disconnection",
					body: (
						<>
							<ul className="list-disc space-y-2 pl-5">
								<li>
									Use the in-app reset tools or your browser&apos;s site-data controls to clear local
									IndexedDB data from a device.
								</li>
								<li>
									Use the Firebase settings panel to clear Firebase data from your configured
									Firestore project or to remove the Firebase configuration from this browser.
								</li>
								<li>
									Use the Google Sheets panel to disconnect the Sheets permission. You can also delete
									backup spreadsheets directly from your Google Drive.
								</li>
								<li>
									Signing out removes the local offline session snapshot from this browser.
								</li>
							</ul>
						</>
					),
				},
				{
					title: "Contact",
					body: (
						<>
							<p>
								For privacy questions, contact the project owner through the MizanTrack GitHub
								repository at{" "}
								<a
									href="https://github.com/salmanzahidlatif/mizantrack/issues"
									className="text-foreground underline underline-offset-4">
									github.com/salmanzahidlatif/mizantrack/issues
								</a>
								.
							</p>
						</>
					),
				},
			]}
		/>
	);
}
