import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let spotify: typeof import("../src/spotify");
const config = { clientId: "concurrent-client", clientSecret: "secret", refreshToken: "refresh" };

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("SPOTIFY_REFRESH_TOKEN", undefined);
  spotify = await import("../src/spotify");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const modes = [{ label: "catalog", user: false }, { label: "user", user: true }] as const;

async function clientFor(user: boolean) {
  return user ? spotify.getSpotifyUserClient(config) : spotify.getSpotifyClient(config);
}

describe("Token request concurrency", () => {
  it.each(modes)("shares one pending token request for $label calls", async ({ user }) => {
    const token = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    let tokenRequests = 0;
    const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      if (String(input).includes("accounts.spotify.com")) {
        tokenRequests++;
        started.resolve();
        // Response bodies are single-use, even when requests share a fixture.
        return (await token.promise).clone();
      }
      return Response.json({ id: "track1", type: "track" });
    });
    vi.stubGlobal("fetch", fetch);
    const client = await clientFor(user);
    const requests = Promise.all([
      client.tracks.get("track1"),
      client.tracks.get("track1"),
      client.tracks.get("track1"),
    ]);
    await started.promise;
    token.resolve(Response.json({ access_token: "access", expires_in: 3600, token_type: "Bearer" }));

    expect(await requests).toEqual(Array(3).fill({ id: "track1", type: "track" }));
    await client.tracks.get("track1");
    expect(tokenRequests).toBe(1);
  });

  it.each(modes)("allows a fresh token request after a shared failure for $label calls", async ({ user }) => {
    let tokenRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      if (String(input).includes("accounts.spotify.com")) {
        tokenRequests++;
        return tokenRequests === 1
          ? Response.json({ error: "invalid_client" }, { status: 400 })
          : Response.json({ access_token: "recovered", expires_in: 3600, token_type: "Bearer" });
      }
      return Response.json({ id: "track1" });
    }));
    const client = await clientFor(user);
    const results = await Promise.allSettled([client.tracks.get("track1"), client.tracks.get("track1")]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await expect(client.tracks.get("track1")).resolves.toEqual({ id: "track1" });
    expect(tokenRequests).toBe(2);
  });

  it.each(modes)("refreshes once at the cached token expiry margin for $label calls", async ({ user }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.now();
    let tokenRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      if (String(input).includes("accounts.spotify.com")) {
        tokenRequests++;
        return Response.json({ access_token: `access-${tokenRequests}`, expires_in: 3600, token_type: "Bearer" });
      }
      return Response.json({ id: "track1" });
    }));
    const client = await clientFor(user);
    await client.tracks.get("track1");
    vi.setSystemTime(now + 3_540_000 - 1);
    await client.tracks.get("track1");
    expect(tokenRequests).toBe(1);
    vi.setSystemTime(now + 3_540_000);
    await Promise.all([client.tracks.get("track1"), client.tracks.get("track1")]);
    expect(tokenRequests).toBe(2);
    await client.tracks.get("track1");
    expect(tokenRequests).toBe(2);
  });

  it("persists a rotated token once before concurrent user calls complete", async () => {
    const saved = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const register = vi.fn(async () => { started.resolve(); await saved.promise; });
    const api = { runtime: { state: { openKeyedStoreV2: <T>() => ({
      lookup: async () => undefined as T | undefined,
      register,
    }) } } };
    let tokenRequests = 0;
    let trackRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      if (String(input).includes("accounts.spotify.com")) {
        tokenRequests++;
        return Response.json({ access_token: "access", expires_in: 3600, refresh_token: "rotated", token_type: "Bearer" });
      }
      trackRequests++;
      return Response.json({ id: "track1" });
    }));
    const client = await spotify.getSpotifyUserClient(config, api);
    const requests = Promise.all([client.tracks.get("track1"), client.tracks.get("track1")]);
    await started.promise;
    expect(trackRequests).toBe(0);
    saved.resolve();
    await requests;
    expect(tokenRequests).toBe(1);
    expect(register).toHaveBeenCalledExactlyOnceWith("user-refresh-token", {
      refreshToken: "rotated", savedAt: expect.any(String),
    });
    expect(trackRequests).toBe(2);
  });

  it("reuses the refreshed client when a later tool acquires it during token persistence", async () => {
    const saveStarted = Promise.withResolvers<void>();
    const finishSave = Promise.withResolvers<void>();
    const records = new Map<string, unknown>();
    const api = { runtime: { state: { openKeyedStoreV2: <T>() => ({
      lookup: async (key: string) => records.get(key) as T | undefined,
      register: async (key: string, value: T) => {
        saveStarted.resolve();
        await finishSave.promise;
        records.set(key, value);
      },
    }) } } };
    let tokenRequests = 0;
    let trackRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      if (String(input).includes("accounts.spotify.com")) {
        tokenRequests++;
        return Response.json({ access_token: "access", expires_in: 3600, refresh_token: "rotated", token_type: "Bearer" });
      }
      trackRequests++;
      return Response.json({ id: "track1" });
    }));
    const first = await spotify.getSpotifyUserClient(config, api);
    const firstRequest = first.tracks.get("track1");
    await saveStarted.promise;
    const second = await spotify.getSpotifyUserClient(config, api);
    const secondRequest = second.tracks.get("track1");
    expect(trackRequests).toBe(0);
    finishSave.resolve();
    await Promise.all([firstRequest, secondRequest]);
    const third = await spotify.getSpotifyUserClient(config, api);
    await third.tracks.get("track1");
    expect(tokenRequests).toBe(1);
    expect(trackRequests).toBe(3);
    expect(records.get("user-refresh-token")).toMatchObject({ refreshToken: "rotated" });
  });

  it("commits overlapping token saves in order so the newest login remains on disk", async () => {
    const oldStarted = Promise.withResolvers<void>();
    const releaseOld = Promise.withResolvers<void>();
    let stored: unknown;
    const register = vi.fn(async (_key: string, value: unknown) => {
      if ((value as { refreshToken: string }).refreshToken === "old") {
        oldStarted.resolve();
        await releaseOld.promise;
      }
      stored = value;
    });
    const api = { runtime: { state: { openKeyedStoreV2: <T>() => ({
      lookup: async () => stored as T | undefined,
      register,
    }) } } };
    const oldSave = spotify.saveSpotifyRefreshToken(api, { refreshToken: "old" });
    await oldStarted.promise;
    const newSave = spotify.saveSpotifyRefreshToken(api, { refreshToken: "new" });
    expect(register).toHaveBeenCalledTimes(1);
    releaseOld.resolve();
    await expect(oldSave).resolves.toMatchObject({ persisted: true });
    await expect(newSave).resolves.toMatchObject({ persisted: true });
    expect(register).toHaveBeenCalledTimes(2);
    expect(stored).toMatchObject({ refreshToken: "new" });
  });

  it.each([
    { label: "a different token", newToken: "new-login" },
    { label: "the same token", newToken: "refresh" },
  ])("keeps a newer login with $label when an older refresh rotates", async ({ newToken }) => {
    const refreshStarted = Promise.withResolvers<void>();
    const finishRefresh = Promise.withResolvers<Response>();
    let stored: unknown;
    const register = vi.fn(async (_key: string, value: unknown) => { stored = value; });
    const api = { runtime: { state: { openKeyedStoreV2: <T>() => ({
      lookup: async () => stored as T | undefined,
      register,
    }) } } };
    await spotify.saveSpotifyRefreshToken(api, { refreshToken: "refresh" });
    register.mockClear();
    const tokenInputs: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      if (String(input).includes("accounts.spotify.com")) {
        const refreshToken = new URLSearchParams(String(init?.body)).get("refresh_token")!;
        tokenInputs.push(refreshToken);
        if (tokenInputs.length === 1) {
          refreshStarted.resolve();
          return finishRefresh.promise;
        }
        return Response.json({ access_token: "new-access", expires_in: 3600, token_type: "Bearer" });
      }
      return Response.json({ id: "track1" });
    }));
    const oldClient = await spotify.getSpotifyUserClient(config, api);
    const oldRequest = oldClient.tracks.get("track1");
    await refreshStarted.promise;
    await spotify.saveSpotifyRefreshToken(api, { refreshToken: newToken });
    const newClient = await spotify.getSpotifyUserClient(config, api);
    await newClient.tracks.get("track1");
    finishRefresh.resolve(Response.json({
      access_token: "old-access", expires_in: 3600, token_type: "Bearer", refresh_token: "stale-rotation",
    }));
    await oldRequest;
    await (await spotify.getSpotifyUserClient(config, api)).tracks.get("track1");
    expect(tokenInputs).toEqual(["refresh", newToken]);
    expect(stored).toMatchObject({ refreshToken: newToken });
    expect(register).toHaveBeenCalledTimes(1);
  });
});
