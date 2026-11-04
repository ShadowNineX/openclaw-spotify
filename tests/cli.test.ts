import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oauth = vi.hoisted(() => ({ start: vi.fn(), wait: vi.fn() }));

vi.mock("../src/oauth-flow", () => ({
  startSpotifyOauthFlow: oauth.start,
  waitForSpotifyOauthFlowCompletion: oauth.wait,
}));

let registerSpotifyCli: typeof import("../src/cli").registerSpotifyCli;

function registerLoginAction() {
  let action: ((options: unknown) => Promise<void>) | undefined;
  const login = {
    action: (handler: typeof action) => { action = handler; return login; },
    description: () => login,
    option: () => login,
  };
  const auth = { command: () => login, description: () => auth };
  const spotify = { command: () => auth, description: () => spotify };
  registerSpotifyCli({ api: {} as never, config: {} as never, program: { command: () => spotify } as never });
  return () => action!;
}

beforeEach(async () => {
  vi.resetModules();
  oauth.start.mockResolvedValue({
    authorizationUrl: "https://accounts.spotify.com/authorize",
    callbackUrl: "http://127.0.0.1:4388/callback",
    expiresAt: "2026-11-04T00:00:00.000Z",
    persistence: { enabled: true, storage: "openclaw-config" },
    scopes: [],
  });
  oauth.wait.mockResolvedValue({ persisted: true, storage: "openclaw-config" });
  ({ registerSpotifyCli } = await import("../src/cli"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Spotify auth login CLI", () => {
  it.each([
    { label: "IPv4 callback", callbackUrl: "http://127.0.0.1:4388/callback", tunnel: "ssh -L 4388:127.0.0.1:4388 user@your-vps" },
    { label: "IPv6 callback", callbackUrl: "http://[::1]:4388/callback", tunnel: "ssh -L 4388:[::1]:4388 user@your-vps" },
  ])("prints a matching SSH tunnel for an $label", async ({ callbackUrl, tunnel }) => {
    oauth.start.mockResolvedValueOnce({
      authorizationUrl: "https://accounts.spotify.com/authorize",
      callbackUrl,
      expiresAt: "2026-11-04T00:00:00.000Z",
      persistence: { enabled: true, storage: "openclaw-config" },
      scopes: [],
    });
    const getAction = registerLoginAction();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await getAction()({ timeout: 30 });

    expect(log).toHaveBeenCalledWith(`  ${tunnel}`);
  });

  it("throws the completed callback error instead of reporting a timeout", async () => {
    oauth.wait.mockResolvedValueOnce({
      error: "Spotify authorization was cancelled.",
      persisted: false,
      storage: "manual-config-or-env",
    });
    const getAction = registerLoginAction();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(getAction()({ timeout: 30 })).rejects.toThrow("Spotify authorization was cancelled.");
  });
});
