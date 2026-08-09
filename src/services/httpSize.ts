import { USER_AGENT } from '../config.js';

// Perform an HTTP HEAD request to fetch file size without downloading it
export async function fetchSizeFromUrl(url: string): Promise<number> {
    try {
        // Use a short 3-second timeout so the script doesn't hang on dead links
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(url, {
            method: 'HEAD',
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const contentLength = response.headers.get('content-length');
            if (contentLength) return parseInt(contentLength, 10);
        }
    } catch (err) {
        // Ignore timeouts and network errors, just return 0 as fallback
    }
    return 0;
}
