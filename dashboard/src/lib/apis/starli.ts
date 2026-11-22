export interface StarliOverview {
  company: { id: string; name: string } | null;
  agents: Array<{ id: string; name: string; status: string }>;
  tools: Array<{ id: string; name: string; description?: string }>;
  browser: { available: boolean; reason?: string };
  credits: { available: boolean; balance: number | null; unit: string };
  readOnly: boolean;
}

export class StarliOverviewError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "StarliOverviewError";
    this.status = status;
  }
}

const OVERVIEW_PATH = "/api/v1/starli/overview";
const MAX_TOKEN_LENGTH = 16_384;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNamedRecord(value: unknown): value is { id: string; name: string } {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isOverview(value: unknown): value is StarliOverview {
  if (!isRecord(value) || typeof value.readOnly !== "boolean") return false;

  const company = value.company;
  if (company !== null && !isNamedRecord(company)) return false;

  if (!Array.isArray(value.agents) || !value.agents.every(
    (agent) => isNamedRecord(agent) && typeof agent.status === "string",
  )) return false;

  if (!Array.isArray(value.tools) || !value.tools.every(
    (tool) => isNamedRecord(tool) && (tool.description === undefined || typeof tool.description === "string"),
  )) return false;

  const browser = value.browser;
  if (!isRecord(browser) || typeof browser.available !== "boolean" ||
      (browser.reason !== undefined && typeof browser.reason !== "string")) return false;

  const credits = value.credits;
  return isRecord(credits) && typeof credits.available === "boolean" &&
    (credits.balance === null || (typeof credits.balance === "number" && Number.isFinite(credits.balance))) &&
    typeof credits.unit === "string";
}

/** Fetch the authenticated overview from this origin; response data is never fabricated. */
export async function fetchStarliOverview(
  token: string,
  signal?: AbortSignal,
): Promise<StarliOverview> {
  if (typeof token !== "string" || token.trim().length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new StarliOverviewError("A valid user access token is required. Sign in again and retry.");
  }

  let response: Response;
  try {
    response = await fetch(OVERVIEW_PATH, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      ...(signal ? { signal } : {}),
    });
  } catch {
    if (signal?.aborted) {
      throw new StarliOverviewError("The overview request was cancelled. Retry when ready.");
    }
    throw new StarliOverviewError("Could not reach the Starli overview. Check your connection and retry.");
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new StarliOverviewError("Your session is not authorized. Sign in again and retry.", status);
    }
    throw new StarliOverviewError(`Starli overview request failed (HTTP ${status}). Check service status and retry.`, status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StarliOverviewError("Starli returned unreadable JSON. Retry shortly; contact support if this continues.");
  }

  if (!isOverview(payload)) {
    throw new StarliOverviewError("Starli returned an invalid overview. Refresh and retry; contact support if this continues.");
  }
  return payload;
}
