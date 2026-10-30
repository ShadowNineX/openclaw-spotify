import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpotifyOAuthTokenRecord, SpotifyRuntimeApi } from "../src/spotify";

let spotify: typeof import("../src/spotify");
const config = {
  clientId: "async-state-client",
  clientSecret: "async-state-secret",
  refreshToken: "manual-token",
};
const existingToken: SpotifyOAuthTokenRecord = {
  refreshToken: "existing-token",
  savedAt: "2026-07-07T10:00:00.000Z",
};

function createStore() {
  const records = new Map<string, unknown>();
  return {
    records,
    lookup: vi.fn(async (key: string) => records.get(key)),
    register: vi.fn(async (key: string, value: unknown) => {
      records.set(key, value);
    }),
  };
}

function createApi(
  store: ReturnType<typeof createStore>,
  opener: "openKeyedStoreV2" | "openKeyedStore" = "openKeyedStoreV2",
): SpotifyRuntimeApi {
  return {
    runtime: {
      state: {
        [opener]: <T>() => ({
          lookup: async (key: string) => await store.lookup(key) as T | undefined,
          register: (key: string, value: T) => store.register(key, value),
        }),
      },
    },
  };
}

function mockSpotify(rotatedToken?: string) {
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0], _init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://accounts.spotify.com/api/token") {
      return Response.json({
        access_token: "state-access-token",
        expires_in: 3600,
        token_type: "Bearer",
        ...(rotatedToken ? { refresh_token: rotatedToken } : {}),
      });
    }
    if (url === "https://api.spotify.com/v1/me") {
      return Response.json({ id: "me" });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(async () => {
  vi.resetModules();
  spotify = await import("../src/spotify");
  vi.stubEnv("SPOTIFY_CLIENT_ID", undefined);
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", undefined);
  vi.stubEnv("SPOTIFY_REFRESH_TOKEN", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("async OAuth state", () => {
  it.each([
    { label: "V2", opener: "openKeyedStoreV2" },
    { label: "minimum gateway async API", opener: "openKeyedStore" },
  ] as const)("preserves stored tokens and namespace with the $label", async ({ opener }) => {
    const store = createStore();
    store.records.set("user-refresh-token", existingToken);
    const api = createApi(store, opener);
    const open = vi.spyOn(api.runtime!.state!, opener);
    const fetch = mockSpotify();

    const client = await spotify.getSpotifyUserClient(config, api);
    await client.users.getCurrentProfile();

    expect(open).toHaveBeenCalledWith({ namespace: "oauth", maxEntries: 1 });
    expect(store.lookup).toHaveBeenCalledWith("user-refresh-token");
    const tokenRequest = fetch.mock.calls.find(([input]) => String(input).includes("accounts.spotify.com"));
    expect(new URLSearchParams(String(tokenRequest?.[1]?.body)).get("refresh_token")).toBe("existing-token");

    await expect(spotify.saveSpotifyRefreshToken(api, { refreshToken: "new-token" })).resolves.toEqual({
      persisted: true,
      storage: "openclaw-plugin-state",
    });
    expect(store.records.get("user-refresh-token")).toEqual({
      refreshToken: "new-token",
      savedAt: expect.any(String),
    });
  });

  it("awaits a stored token read before returning the client", async () => {
    const store = createStore();
    const started = Promise.withResolvers<void>();
    const read = Promise.withResolvers<unknown>();
    store.lookup.mockImplementationOnce(() => {
      started.resolve();
      return read.promise;
    });
    const fetch = mockSpotify();
    let settled = false;
    const pending = spotify.getSpotifyUserClient(config, createApi(store));
    void pending.then(() => { settled = true; });

    await started.promise;
    expect(settled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    read.resolve(existingToken);
    const client = await pending;
    await expect(client.users.getCurrentProfile()).resolves.toMatchObject({ id: "me" });
  });

  it("awaits the state commit before reporting token persistence", async () => {
    const store = createStore();
    const started = Promise.withResolvers<void>();
    const commit = Promise.withResolvers<void>();
    store.register.mockImplementationOnce(async (key, value) => {
      started.resolve();
      await commit.promise;
      store.records.set(key, value);
    });
    let settled = false;
    const pending = spotify.saveSpotifyRefreshToken(createApi(store), { refreshToken: "new-token" });
    void pending.then(() => { settled = true; });

    await started.promise;
    expect(settled).toBe(false);
    expect(store.records.size).toBe(0);
    commit.resolve();
    await expect(pending).resolves.toEqual({ persisted: true, storage: "openclaw-plugin-state" });
    expect(store.records.get("user-refresh-token")).toMatchObject({ refreshToken: "new-token" });
  });

  it("prefers a completed login over an older pending state read", async () => {
    const store = createStore();
    const started = Promise.withResolvers<void>();
    const read = Promise.withResolvers<unknown>();
    store.lookup.mockImplementationOnce(() => {
      started.resolve();
      return read.promise;
    });
    const api = createApi(store);
    const fetch = mockSpotify();
    const pending = spotify.getSpotifyUserClient(config, api);
    await started.promise;

    await spotify.saveSpotifyRefreshToken(api, { refreshToken: "new-login-token" });
    read.resolve(existingToken);
    const client = await pending;
    await client.users.getCurrentProfile();

    const tokenRequest = fetch.mock.calls.find(([input]) => String(input).includes("accounts.spotify.com"));
    expect(new URLSearchParams(String(tokenRequest?.[1]?.body)).get("refresh_token")).toBe("new-login-token");
  });

  it("prefers V2 without opening the older async store", async () => {
    const api = createApi(createStore());
    const oldOpen = vi.fn(() => { throw new Error("Older store must not open"); });
    api.runtime!.state!.openKeyedStore = oldOpen;

    await expect(spotify.saveSpotifyRefreshToken(api, { refreshToken: "new-token" })).resolves.toMatchObject({
      persisted: true,
    });
    expect(oldOpen).not.toHaveBeenCalled();
  });

  it("does not retry an operational V2 failure through the older store", async () => {
    const api = createApi(createStore());
    api.runtime!.state!.openKeyedStoreV2 = () => { throw new Error("State owner retired"); };
    const oldOpen = vi.fn(() => { throw new Error("Older store must not open"); });
    api.runtime!.state!.openKeyedStore = oldOpen;

    await expect(spotify.saveSpotifyRefreshToken(api, { refreshToken: "new-token" })).resolves.toEqual({
      persisted: false,
      storage: "manual-config-or-env",
      error: "openclaw-plugin-state: State owner retired",
    });
    expect(oldOpen).not.toHaveBeenCalled();
  });

  it("reports rejected state writes together with config persistence errors", async () => {
    const store = createStore();
    store.register.mockRejectedValueOnce(new Error("State write failed"));
    const api = createApi(store);
    api.runtime!.config = { mutateConfigFile: async () => { throw new Error("Config is read only"); } };

    await expect(spotify.saveSpotifyRefreshToken(api, { refreshToken: "new-token" })).resolves.toEqual({
      persisted: false,
      storage: "manual-config-or-env",
      error: "openclaw-config: Config is read only; openclaw-plugin-state: State write failed",
    });
    expect(store.records.size).toBe(0);
  });

  it("falls back from config persistence to an awaited async state write", async () => {
    const store = createStore();
    const api = createApi(store);
    api.runtime!.config = { mutateConfigFile: async () => { throw new Error("Config is read only"); } };

    await expect(spotify.saveSpotifyRefreshToken(api, { refreshToken: "fallback-token" })).resolves.toEqual({
      persisted: true,
      storage: "openclaw-plugin-state",
    });
    expect(store.records.get("user-refresh-token")).toMatchObject({ refreshToken: "fallback-token" });
  });

  it("keeps successful config persistence independent of state availability", async () => {
    const api = createApi(createStore());
    const open = vi.spyOn(api.runtime!.state!, "openKeyedStoreV2");
    const draft = {};
    api.runtime!.config = { mutateConfigFile: async ({ mutate }) => { await mutate(draft); } };

    await expect(spotify.saveSpotifyRefreshToken(api, { refreshToken: "config-token" })).resolves.toEqual({
      persisted: true,
      storage: "openclaw-config",
    });
    expect(draft).toMatchObject({ plugins: { entries: { spotify: { config: { refreshToken: "config-token" } } } } });
    expect(open).not.toHaveBeenCalled();
  });

  it("reports unavailable async persistence without invoking the retired sync API", async () => {
    const syncOpen = vi.fn(() => { throw new Error("Retired API must not run"); });
    const api = { runtime: { state: { openSyncKeyedStore: syncOpen } } } as unknown as SpotifyRuntimeApi;
    const fetch = mockSpotify();

    expect(spotify.canPersistSpotifyRefreshToken(api)).toBe(false);
    await expect(spotify.saveSpotifyRefreshToken(api, { refreshToken: "unsaved-token" })).resolves.toEqual({
      persisted: false,
      storage: "manual-config-or-env",
      error: undefined,
    });
    const client = await spotify.getSpotifyUserClient(config);
    await client.users.getCurrentProfile();
    expect(fetch).toHaveBeenCalled();
    expect(syncOpen).not.toHaveBeenCalled();
  });

  it("surfaces failed state reads before attempting Spotify or stale credentials", async () => {
    const store = createStore();
    store.lookup.mockRejectedValueOnce(new Error("State read refused"));
    const fetch = mockSpotify();

    await expect(spotify.getSpotifyUserClient(config, createApi(store))).rejects.toThrow("State read refused");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists rotated tokens to the requesting runtime when credentials match", async () => {
    const storeA = createStore();
    const storeB = createStore();
    storeA.records.set("user-refresh-token", existingToken);
    storeB.records.set("user-refresh-token", existingToken);
    const apiA = createApi(storeA);
    const apiB = createApi(storeB);
    mockSpotify("rotated-token");
    await spotify.getSpotifyUserClient(config, apiA);
    const clientB = await spotify.getSpotifyUserClient(config, apiB);

    await clientB.users.getCurrentProfile();

    expect(storeA.records.get("user-refresh-token")).toEqual(existingToken);
    expect(storeA.register).not.toHaveBeenCalled();
    expect(storeB.records.get("user-refresh-token")).toMatchObject({ refreshToken: "rotated-token" });
  });
});
