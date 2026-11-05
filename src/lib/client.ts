import { buildAuthHeaders, getAppUrl } from "./auth.js";
import { API_PATH, APP_CLI, APP_VERSION } from "./config.js";
import { CliError, SUGGESTIONS } from "./errors.js";
import { log } from "./logger.js";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];
/** Drive scans, OpenAI line breaks and Alugha uploads can take minutes. */
const TIMEOUT_MS = 10 * 60 * 1000;

/** HTTP methods supported by the client */
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Options for an API request */
interface RequestOptions {
  params?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  timeout?: number;
}

/**
 * Make an authenticated request to the ESM API (`<app-url>/api/v1`).
 *
 * Retries: 429 always; 503/504 and network errors only for GET. A failed
 * POST may already have started a translation or an upload, so it never
 * retries. 502 is a processing backend error: retrying would not help.
 */
async function request(method: Method, path: string, opts: RequestOptions = {}): Promise<unknown> {
  let url = `${getAppUrl()}${API_PATH}${path}`;

  if (opts.params) {
    const filtered = Object.fromEntries(
      Object.entries(opts.params).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== ""),
    );
    if (Object.keys(filtered).length > 0) {
      url += `?${new URLSearchParams(filtered).toString()}`;
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    // Logged by the FTO app next to the tool name.
    "x-tool-source": "cli",
    // The app refuses (426) a CLI older than its minimum version.
    "x-cli-version": `${APP_CLI}/${APP_VERSION}`,
    ...buildAuthHeaders(),
  };

  const isIdempotent = method === "GET";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    log.debug(`${method} ${url}${attempt > 0 ? ` (retry ${attempt})` : ""}`);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body && method !== "GET" ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeout ?? TIMEOUT_MS),
      });
    } catch (err) {
      if (isIdempotent && attempt < MAX_RETRIES) {
        await Bun.sleep(RETRY_DELAYS[attempt] ?? 4000);
        continue;
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new CliError(1, `Cannot reach ${getAppUrl()}: ${reason}`, "Check the app URL: esm-fto-cli auth show");
    }

    const canRetry = res.status === 429 || (isIdempotent && (res.status === 503 || res.status === 504));
    if (canRetry && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt] ?? 4000;
      log.warn(`${res.status} - retrying in ${delay / 1000}s...`);
      await Bun.sleep(delay);
      continue;
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const body = data as {
        error?: { message?: string };
        message?: string;
        errors?: { path?: (string | number)[]; message?: string }[];
      } | null;
      const msg = body?.error?.message ?? body?.message ?? res.statusText;
      // Input validation errors list the offending fields.
      const issues = Array.isArray(body?.errors)
        ? body.errors.map((issue) => `${issue.path?.join(".") || "input"}: ${issue.message ?? "invalid"}`).join("; ")
        : "";
      throw new CliError(res.status, issues ? `${msg} (${issues})` : String(msg), SUGGESTIONS[res.status]);
    }

    return data;
  }

  throw new CliError(500, "Max retries exceeded");
}

/** Typed HTTP client with convenience methods */
export const client = {
  /** GET request with optional query params */
  get<T = unknown>(path: string, params?: Record<string, string | undefined>) {
    return request("GET", path, { params }) as Promise<T>;
  },

  /** POST request with JSON body */
  post<T = unknown>(path: string, body?: Record<string, unknown>) {
    return request("POST", path, { body: body ?? {} }) as Promise<T>;
  },

  /** PATCH request with JSON body */
  patch<T = unknown>(path: string, body?: Record<string, unknown>) {
    return request("PATCH", path, { body }) as Promise<T>;
  },

  /** PUT request with JSON body */
  put<T = unknown>(path: string, body?: Record<string, unknown>) {
    return request("PUT", path, { body }) as Promise<T>;
  },

  /** DELETE request */
  delete<T = unknown>(path: string) {
    return request("DELETE", path) as Promise<T>;
  },
};

/** Encode a path segment (video code, language, id). */
export const seg = (value: string) => encodeURIComponent(value.trim());
