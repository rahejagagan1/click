import { delay } from "@/lib/utils";

const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";
const RATE_LIMIT_DELAY = 650; // ms between calls

let lastCallTime = 0;

export async function clickupApi<T = any>(
    endpoint: string,
    options?: RequestInit
): Promise<T> {
    const token = process.env.CLICKUP_API_TOKEN;
    if (!token) {
        throw new Error("CLICKUP_API_TOKEN environment variable is not set");
    }

    // Rate limiting: wait at least 650ms between calls
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    if (timeSinceLastCall < RATE_LIMIT_DELAY) {
        await delay(RATE_LIMIT_DELAY - timeSinceLastCall);
    }
    lastCallTime = Date.now();

    const url = `${CLICKUP_API_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: token,
            "Content-Type": "application/json",
            ...options?.headers,
        },
    });

    if (response.status === 429) {
        // Rate limited — wait and retry
        console.warn("[ClickUp] Rate limited, waiting 60 seconds...");
        await delay(60000);
        return clickupApi(endpoint, options);
    }

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "No body");
        throw new Error(
            `ClickUp API error: ${response.status} ${response.statusText} - ${errorBody}`
        );
    }

    return response.json();
}

export const WORKSPACE_ID = "9016734871";

export const TARGET_SPACE_IDS = [
    "90165582699", // New Production Line (PRIMARY)
    "90162701586", // Production (SECONDARY)
    "90165681655", // NB Media HQ (TERTIARY)
];
