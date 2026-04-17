// SWR global configuration + fetcher
// SWR provides: caching, revalidation, deduplication, error retry

export const fetcher = (url: string) =>
    fetch(url).then((res) => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
    });

// Default SWR options for the app
export const swrConfig = {
    revalidateOnFocus: true,      // Refetch when tab regains focus
    refreshInterval: 30000,       // Auto-refresh every 30 seconds
    dedupingInterval: 10000,      // Deduplicate requests within 10 seconds
    errorRetryCount: 2,           // Retry failed requests twice
    keepPreviousData: true,       // Show stale data while revalidating
};
