import { auth } from "@/lib/auth";
import { listSheetsCurrencyStates } from "@/lib/sheets/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized", code: "Unauthorized" }, { status: 401 });
	}
	return Response.json({
		connected: session.googleSheets?.connected ?? false,
		needsReconnect: session.googleSheets?.needsReconnect ?? false,
		states: await listSheetsCurrencyStates(),
	});
}
