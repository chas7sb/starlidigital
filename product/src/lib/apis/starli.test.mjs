import test from "node:test";
import assert from "node:assert/strict";
import { fetchStarliOverview, StarliOverviewError } from "./starli.ts";

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const validOverview = {
  company: { id: "company-1", name: "Example Co" },
  agents: [{ id: "agent-1", name: "Assistant", status: "active" }],
  tools: [{ id: "tool-1", name: "Lookup", description: "Read-only lookup" }],
  browser: { available: false, reason: "Backend unavailable" },
  credits: { available: false, balance: null, unit: "credits" },
  readOnly: true,
};

test("requests the same-origin overview with the supplied bearer token", async () => {
  const controller = new AbortController();
  let requestedUrl;
  let requestOptions;
  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    requestOptions = options;
    return new Response(JSON.stringify(validOverview), { status: 200 });
  };

  assert.deepEqual(await fetchStarliOverview("user-jwt", controller.signal), validOverview);
  assert.equal(requestedUrl, "/api/v1/starli/overview");
  assert.equal(requestOptions.method, "GET");
  assert.equal(requestOptions.headers.Authorization, "Bearer user-jwt");
  assert.equal(requestOptions.signal, controller.signal);
  assert.equal("credentials" in requestOptions, false);
});

test("accepts an absent company and absent optional descriptions", async () => {
  const overview = {
    ...validOverview,
    company: null,
    agents: [],
    tools: [{ id: "tool-2", name: "Status" }],
    browser: { available: true },
  };
  globalThis.fetch = async () => new Response(JSON.stringify(overview), { status: 200 });
  assert.deepEqual(await fetchStarliOverview("jwt"), overview);
});

test("rejects malformed overview fields instead of treating the backend as connected", async () => {
  const invalid = { ...validOverview, browser: { available: "yes" } };
  globalThis.fetch = async () => new Response(JSON.stringify(invalid), { status: 200 });
  await assert.rejects(fetchStarliOverview("jwt"), (error) => {
    assert.ok(error instanceof StarliOverviewError);
    assert.match(error.message, /invalid overview/i);
    return true;
  });
});

test("reports auth failures with actionable, bounded errors and no token", async () => {
  const token = "sensitive-user-jwt";
  globalThis.fetch = async () => new Response("ignored", { status: 401 });
  await assert.rejects(fetchStarliOverview(token), (error) => {
    assert.ok(error instanceof StarliOverviewError);
    assert.equal(error.status, 401);
    assert.match(error.message, /sign in again/i);
    assert.equal(error.message.includes(token), false);
    assert.ok(error.message.length <= 200);
    return true;
  });
});

test("does not expose network exception details or tokens", async () => {
  const token = "secret-jwt-value";
  globalThis.fetch = async () => {
    throw new Error(`network error containing ${token}`);
  };
  await assert.rejects(fetchStarliOverview(token), (error) => {
    assert.ok(error instanceof StarliOverviewError);
    assert.equal(error.message.includes(token), false);
    assert.ok(error.message.length <= 200);
    return true;
  });
});

test("rejects empty tokens without echoing input", async () => {
  await assert.rejects(fetchStarliOverview("  "), (error) => {
    assert.ok(error instanceof StarliOverviewError);
    assert.match(error.message, /valid user access token/i);
    return true;
  });
});
