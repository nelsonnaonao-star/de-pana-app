import { authFetch } from "../lib/api";

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await authFetch(url, options);

      if (response.ok) return response;

      if (response.status >= 400 && response.status < 500) {
        return response;
      }

      lastError = new Error(`Server error: ${response.status}`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }

    if (attempt < maxRetries) {
      await delay(Math.pow(2, attempt) * 1000);
    }
  }

  throw lastError || new Error("Max retries exceeded");
}
