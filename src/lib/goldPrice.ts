import { db } from "@/lib/db/local";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const GOLD_API_URL = "https://www.goldapi.io/api/XAU/USD";

interface GoldApiResponse {
	price_gram_24k: number;
	timestamp: number;
}

/**
 * Fetch gold price per gram (24k) in USD.
 * - Returns cached value if fresh (< 1 hour old).
 * - Returns stale cache if API call fails.
 * - Returns null if no API key configured or all sources fail.
 */
export async function fetchGoldPrice(userId: string): Promise<number | null> {
	const config = await db.dbConfig.get(userId);
	if (!config) return null;

	const now = Date.now();

	// Return cached value if fresh
	if (
		config.lastGoldPricePerGram &&
		config.lastGoldPriceFetchedAt &&
		now - config.lastGoldPriceFetchedAt < CACHE_TTL_MS
	) {
		return config.lastGoldPricePerGram;
	}

	// No API key → return stale cache or null
	if (!config.goldApiKey) {
		return config.lastGoldPricePerGram ?? null;
	}

	// Attempt API fetch
	try {
		const res = await fetch(GOLD_API_URL, {
			headers: { "x-access-token": config.goldApiKey },
			signal: AbortSignal.timeout(8000),
		});

		if (!res.ok) {
			// On error, fall back to stale cache
			return config.lastGoldPricePerGram ?? null;
		}

		const data = (await res.json()) as GoldApiResponse;
		const pricePerGram = data.price_gram_24k;

		if (!pricePerGram || pricePerGram <= 0) {
			return config.lastGoldPricePerGram ?? null;
		}

		// Cache the result
		await db.dbConfig.update(userId, {
			lastGoldPricePerGram: pricePerGram,
			lastGoldPriceFetchedAt: now,
		});

		return pricePerGram;
	} catch {
		// Network error → return stale cache
		return config.lastGoldPricePerGram ?? null;
	}
}
