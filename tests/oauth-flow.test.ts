import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({
  createServer: vi.fn(),
  servers: [] as FakeServer[],
}));
const spotify = vi.hoisted(() => ({
  build: vi.fn(),
  canPersist: vi.fn(() => true),
  exchange: vi.fn(),
  persistenceTarget: vi.fn(() => "openclaw-config"),
  save: vi.fn(),
}));

vi.mock("node:http", () => ({ createServer: http.createServer }));
vi.mock("../src/spotify", () => ({
  buildSpotifyAuthorizationUrl: spotify.build,
  canPersistSpotifyRefreshToken: spotify.canPersist,
  exchangeSpotifyAuthorizationCode: spotify.exchange,
  getSpotifyRefreshTokenPersistenceTarget: spotify.persistenceTarget,
  saveSpotifyRefreshToken: spotify.save,
  SPOTIFY_USER_SCOPES: ["user-read-private"],
}));

type Callback = (request: { url?: string }, response: FakeResponse) => Promise<void>;

type FakeServer = {
  close: ReturnType<typeof vi.fn>;
  error?: (error: Error) => void;
  handler: Callback;
  listen: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
};

type FakeResponse = {
  body?: string;
  end: ReturnType<typeof vi.fn>;
  status?: number;
  writeHead: ReturnType<typeof vi.fn>;
};

let oauth: typeof import("../src/oauth-flow");
const config = { clientId: "test-client", clientSecret: "test-secret" };

function createServer(handler: Callback): FakeServer {
  const server: FakeServer = {
    close: vi.fn(),
    handler,
    listen: vi.fn((_port, _host, callback: () => void) => callback()),
    off: vi.fn(),
    once: vi.fn((event: string, callback: (error: Error) => void) => {
      if (event === "error") server.error = callback;
    }),
  };
  http.servers.push(server);
  return server;
}

function response(): FakeResponse {
  const result: FakeResponse = {
    end: vi.fn((body?: string) => { result.body = body; }),
    writeHead: vi.fn((status: number) => { result.status = status; }),
  };
  return result;
}

async function start(state = "expected-state") {
  return await oauth.startSpotifyOauthFlow(config, { state, timeoutSeconds: 30 });
}

async function callback(server: FakeServer, url: string) {
  const result = response();
  await server.handler({ url }, result);
  return result;
}

beforeEach(async () => {
  vi.resetModules();
  http.createServer.mockImplementation(createServer);
  http.servers.length = 0;
  spotify.build.mockResolvedValue({
    authorizationUrl: "https://accounts.spotify.com/authorize",
    codeVerifier: "verifier",
    redirectUri: "http://127.0.0.1:4388/callback",
    scopes: ["user-read-private"],
  });
  spotify.exchange.mockResolvedValue({ refreshToken: "refresh-token", scope: "user-read-private" });
  spotify.save.mockResolvedValue({ persisted: true, storage: "openclaw-config" });
  oauth = await import("../src/oauth-flow");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Spotify OAuth callback flow", () => {
  it("awaits refresh-token persistence before reporting success", async () => {
    const saveStarted = Promise.withResolvers<void>();
    const saveRelease = Promise.withResolvers<{ persisted: true; storage: "openclaw-config" }>();
    spotify.save.mockImplementationOnce(async () => {
      saveStarted.resolve();
      return await saveRelease.promise;
    });
    await start();
    const result = response();
    const pending = http.servers[0]!.handler(
      { url: "/callback?state=expected-state&code=authorization-code" }, result,
    );

    await saveStarted.promise;
    expect(result.writeHead).not.toHaveBeenCalled();
    expect(result.end).not.toHaveBeenCalled();
    saveRelease.resolve({ persisted: true, storage: "openclaw-config" });
    await pending;
    expect(result.status).toBe(200);
    await expect(oauth.waitForSpotifyOauthFlowCompletion(30)).resolves.toMatchObject({ persisted: true });
  });

  it("rejects a competing login while a token save is pending", async () => {
    const saveStarted = Promise.withResolvers<void>();
    const saveRelease = Promise.withResolvers<{ persisted: true; storage: "openclaw-config" }>();
    spotify.save.mockImplementationOnce(async () => {
      saveStarted.resolve();
      return await saveRelease.promise;
    });
    await start("first-state");
    const pendingCallback = callback(http.servers[0]!, "/callback?state=first-state&code=authorization-code");
    await saveStarted.promise;

    await expect(start("second-state")).rejects.toThrow("busy saving a previous refresh token");
    saveRelease.resolve({ persisted: true, storage: "openclaw-config" });
    await pendingCallback;
  });

  it("reports a valid cancellation instead of timing out", async () => {
    await start();
    await expect(callback(http.servers[0]!, "/callback?state=expected-state&error=access_denied")).resolves.toMatchObject({ status: 400 });
    await expect(oauth.waitForSpotifyOauthFlowCompletion(30)).resolves.toMatchObject({
      error: "Spotify authorization was cancelled.",
      persisted: false,
    });
  });

  it("preserves the live flow after an invalid-state error callback", async () => {
    await start();
    const server = http.servers[0]!;
    await expect(callback(server, "/callback?state=wrong-state&error=access_denied")).resolves.toMatchObject({ status: 400 });
    expect(server.close).not.toHaveBeenCalled();

    await callback(server, "/callback?state=expected-state&code=authorization-code");
    await expect(oauth.waitForSpotifyOauthFlowCompletion(30)).resolves.toMatchObject({ persisted: true });
  });

  it("preserves the live flow after unrelated requests", async () => {
    await start();
    const server = http.servers[0]!;
    await expect(callback(server, "/health")).resolves.toMatchObject({ status: 404 });
    expect(server.close).not.toHaveBeenCalled();

    await callback(server, "/callback?state=expected-state&code=authorization-code");
    await expect(oauth.waitForSpotifyOauthFlowCompletion(30)).resolves.toMatchObject({ persisted: true });
  });

  it("reports a missing authorization code instead of timing out", async () => {
    await start();
    await callback(http.servers[0]!, "/callback?state=expected-state");
    await expect(oauth.waitForSpotifyOauthFlowCompletion(30)).resolves.toMatchObject({
      error: "Spotify OAuth callback did not include an authorization code.",
    });
  });

  it("reports an authorization-code exchange failure without exposing callback data", async () => {
    spotify.exchange.mockRejectedValueOnce(new Error("provider rejected sensitive value"));
    await start();
    const result = await callback(http.servers[0]!, "/callback?state=expected-state&code=sensitive-code");

    expect(result).toMatchObject({ status: 500 });
    expect(result.body).not.toContain("sensitive-code");
    await expect(oauth.waitForSpotifyOauthFlowCompletion(30)).resolves.toMatchObject({
      error: "Spotify authorization code exchange failed.",
    });
  });

  it("reports a token-save failure without exposing the refresh token", async () => {
    spotify.save.mockResolvedValueOnce({ persisted: false, storage: "manual-config-or-env", error: "write failed" });
    await start();
    const result = await callback(http.servers[0]!, "/callback?state=expected-state&code=authorization-code");

    expect(result).toMatchObject({ status: 500 });
    expect(result.body).not.toContain("refresh-token");
    await expect(oauth.waitForSpotifyOauthFlowCompletion(30)).resolves.toMatchObject({
      error: "Spotify refresh token could not be saved to OpenClaw.",
    });
  });

  it("processes a duplicate callback only once", async () => {
    const exchangeStarted = Promise.withResolvers<void>();
    const exchangeRelease = Promise.withResolvers<{ refreshToken: string; scope: string }>();
    spotify.exchange.mockImplementationOnce(async () => {
      exchangeStarted.resolve();
      return await exchangeRelease.promise;
    });
    await start();
    const server = http.servers[0]!;
    const first = callback(server, "/callback?state=expected-state&code=authorization-code");
    await exchangeStarted.promise;

    await expect(callback(server, "/callback?state=expected-state&code=authorization-code")).resolves.toMatchObject({ status: 409 });
    expect(spotify.exchange).toHaveBeenCalledTimes(1);
    exchangeRelease.resolve({ refreshToken: "refresh-token", scope: "user-read-private" });
    await first;
  });

  it("does not let an obsolete callback close or complete a newer flow", async () => {
    const exchangeStarted = Promise.withResolvers<void>();
    const exchangeRelease = Promise.withResolvers<{ refreshToken: string; scope: string }>();
    spotify.exchange.mockImplementationOnce(async () => {
      exchangeStarted.resolve();
      return await exchangeRelease.promise;
    });
    await start("old-state");
    const oldServer = http.servers[0]!;
    const oldCallback = callback(oldServer, "/callback?state=old-state&code=authorization-code");
    await exchangeStarted.promise;

    await start("new-state");
    const newServer = http.servers[1]!;
    exchangeRelease.resolve({ refreshToken: "refresh-token", scope: "user-read-private" });
    await oldCallback;
    await callback(newServer, "/callback?state=new-state&code=authorization-code");

    await expect(oauth.waitForSpotifyOauthFlowCompletion(30)).resolves.toMatchObject({ persisted: true });
    expect(newServer.close).toHaveBeenCalledTimes(1);
  });

  it("rejects a waiter when its flow is superseded", async () => {
    vi.useFakeTimers();
    await start("old-state");
    const oldWaiter = oauth.waitForSpotifyOauthFlowCompletion(30);
    const rejected = expect(oldWaiter).rejects.toThrow("superseded before the callback finished");
    await start("new-state");

    await vi.advanceTimersByTimeAsync(500);
    await rejected;
  });

  it.each([
    { label: "HTTPS", redirectUri: "https://127.0.0.1:4388/callback", message: "HTTP loopback" },
    { label: "localhost", redirectUri: "http://localhost:4388/callback", message: "explicit loopback IP" },
    { label: "non-loopback host", redirectUri: "http://example.test:4388/callback", message: "explicit loopback IP" },
    { label: "credentials", redirectUri: "http://user:pass@127.0.0.1:4388/callback", message: "cannot include credentials" },
    { label: "query", redirectUri: "http://127.0.0.1:4388/callback?x=1", message: "cannot include credentials" },
    { label: "fragment", redirectUri: "http://127.0.0.1:4388/callback#part", message: "cannot include credentials" },
    { label: "zero port", redirectUri: "http://127.0.0.1:0/callback", message: "cannot use port 0" },
  ])("rejects a $label redirect URI", async ({ redirectUri, message }) => {
    spotify.build.mockResolvedValueOnce({
      authorizationUrl: "https://accounts.spotify.com/authorize",
      codeVerifier: "verifier",
      redirectUri,
      scopes: [],
    });

    await expect(start()).rejects.toThrow(message);
    expect(http.createServer).not.toHaveBeenCalled();
  });

  it("uses port 80 when the redirect URI omits a port", async () => {
    spotify.build.mockResolvedValueOnce({
      authorizationUrl: "https://accounts.spotify.com/authorize",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1/callback",
      scopes: [],
    });

    await start();
    expect(http.servers[0]!.listen).toHaveBeenCalledWith(80, "127.0.0.1", expect.any(Function));
  });

  it("binds an IPv6 loopback redirect without URL brackets", async () => {
    spotify.build.mockResolvedValueOnce({
      authorizationUrl: "https://accounts.spotify.com/authorize",
      codeVerifier: "verifier",
      redirectUri: "http://[::1]:4388/callback",
      scopes: [],
    });

    await start();
    expect(http.servers[0]!.listen).toHaveBeenCalledWith(4388, "::1", expect.any(Function));
  });

  it("rejects a server start failure without leaving a stale flow", async () => {
    http.createServer.mockImplementationOnce((handler: Callback) => {
      const server = createServer(handler);
      server.listen.mockImplementationOnce(() => server.error!(new Error("port unavailable")));
      return server;
    });

    await expect(start()).rejects.toThrow("port unavailable");
    expect(http.servers[0]!.close).toHaveBeenCalledTimes(1);
    await expect(start("replacement-state")).resolves.toMatchObject({
      callbackUrl: "http://127.0.0.1:4388/callback",
    });
  });

  it("keeps a pending listener alive while rejecting a competing start", async () => {
    const listeningStarted = Promise.withResolvers<void>();
    let finishListen: (() => void) | undefined;
    http.createServer.mockImplementationOnce((handler: Callback) => {
      const server = createServer(handler);
      server.listen.mockImplementationOnce((_port, _host, callback: () => void) => {
        finishListen = callback;
        listeningStarted.resolve();
      });
      return server;
    });

    const firstStart = start("first-state");
    await listeningStarted.promise;
    await expect(start("second-state")).rejects.toThrow("busy starting its callback listener");
    expect(http.servers[0]!.close).not.toHaveBeenCalled();
    finishListen!();
    await expect(firstStart).resolves.toMatchObject({ callbackUrl: "http://127.0.0.1:4388/callback" });
    await callback(http.servers[0]!, "/callback?state=first-state&code=authorization-code");
    expect(http.servers[0]!.close).toHaveBeenCalledTimes(1);
  });

  it("rejects an older concurrent start when a newer start wins", async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    spotify.build.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    const oldStart = start("old-state");
    const newStart = start("new-state");
    second.resolve({
      authorizationUrl: "https://accounts.spotify.com/authorize",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1:4388/callback",
      scopes: [],
    });
    await expect(newStart).resolves.toMatchObject({ callbackUrl: "http://127.0.0.1:4388/callback" });
    first.resolve({
      authorizationUrl: "https://accounts.spotify.com/authorize",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1:4388/callback",
      scopes: [],
    });
    await expect(oldStart).rejects.toThrow("superseded before it could start");
  });

  it("rejects an old start across three overlapping starts", async () => {
    const first = Promise.withResolvers<unknown>();
    const third = Promise.withResolvers<unknown>();
    const auth = (scope: string) => ({
      authorizationUrl: "https://accounts.spotify.com/authorize",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1:4388/callback",
      scopes: [scope],
    });
    spotify.build
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(auth("second"))
      .mockImplementationOnce(() => third.promise);

    const oldStart = start("old-state");
    await expect(start("second-state")).resolves.toMatchObject({ callbackUrl: "http://127.0.0.1:4388/callback" });
    const newestStart = start("newest-state");
    first.resolve(auth("first"));
    await expect(oldStart).rejects.toThrow("superseded before it could start");
    third.resolve(auth("third"));
    await expect(newestStart).resolves.toMatchObject({ callbackUrl: "http://127.0.0.1:4388/callback" });
  });

  it("closes an expired listener and prevents a late exchange from saving", async () => {
    vi.useFakeTimers();
    const exchangeStarted = Promise.withResolvers<void>();
    const exchangeRelease = Promise.withResolvers<{ refreshToken: string; scope: string }>();
    spotify.exchange.mockImplementationOnce(async () => {
      exchangeStarted.resolve();
      return await exchangeRelease.promise;
    });
    await start();
    const server = http.servers[0]!;
    const pendingCallback = callback(server, "/callback?state=expected-state&code=authorization-code");
    await exchangeStarted.promise;

    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.close).toHaveBeenCalledTimes(1);
    await expect(oauth.waitForSpotifyOauthFlowCompletion(30)).rejects.toThrow("Spotify OAuth login timed out before the callback finished.");
    exchangeRelease.resolve({ refreshToken: "refresh-token", scope: "user-read-private" });
    await expect(pendingCallback).resolves.toMatchObject({ status: 409 });
    expect(spotify.save).not.toHaveBeenCalled();
  });

  it("returns a completion recorded just before the wait deadline", async () => {
    vi.useFakeTimers();
    await start();
    const waiter = oauth.waitForSpotifyOauthFlowCompletion(30);

    await vi.advanceTimersByTimeAsync(29_900);
    await callback(http.servers[0]!, "/callback?state=expected-state&code=authorization-code");
    await vi.advanceTimersByTimeAsync(100);
    await expect(waiter).resolves.toMatchObject({ persisted: true });
  });
});
