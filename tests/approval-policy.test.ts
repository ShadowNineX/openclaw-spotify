import type { DefinedToolPluginEntry } from "openclaw/plugin-sdk/tool-plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpotifyApprovalApi, SpotifyToolCallEvent } from "../src/approval-policy";
import type { SpotifyPluginConfig } from "../src/index";
import type { SpotifyRuntimeApi } from "../src/spotify";

let entry: DefinedToolPluginEntry;

beforeEach(async () => {
  // Spotify clients capture fetch and cache tokens; isolate each HTTP fixture.
  vi.resetModules();
  entry = (await import("../index")).default;
});

const config: SpotifyPluginConfig = {
  clientId: "approval-client",
  clientSecret: "approval-secret",
  refreshToken: "approval-refresh-token",
};

function registerHook(
  pluginConfig: SpotifyPluginConfig | undefined = config,
  runtime?: SpotifyRuntimeApi["runtime"],
) {
  let handler: Parameters<SpotifyApprovalApi["on"]>[1] | undefined;

  entry.register({
    pluginConfig,
    runtime,
    registerCli: vi.fn(),
    registerTool: vi.fn(),
    on: (event: string, callback: typeof handler) => {
      if (event === "before_tool_call") handler = callback;
    },
  } as unknown as Parameters<typeof entry.register>[0]);

  expect(handler).toBeTypeOf("function");
  // Typed OpenClaw hooks receive toolName/params, without event.context.
  return (event: SpotifyToolCallEvent) => handler!(event);
}

function mockSpotify(name: string | undefined = "Road trip", status = 200) {
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0], _init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://accounts.spotify.com/api/token") {
      return Response.json({
        access_token: "approval-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    if (url === "https://api.spotify.com/v1/playlists/playlist1") {
      return Response.json({ id: "playlist1", name }, { status });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const protectedActions = [
  {
    action: "delete",
    toolName: "spotify_delete_playlist",
    params: { id: "playlist1" },
    title: 'Delete Spotify playlist: "Road trip"',
    description: 'Remove playlist "Road trip" from your Spotify library.',
    severity: "critical",
  },
  {
    action: "removeTracks",
    toolName: "spotify_remove_playlist_tracks",
    params: { id: "playlist1", uris: ["spotify:track:track-1"] },
    title: 'Remove tracks from Spotify playlist: "Road trip"',
    description: 'Remove 1 track from playlist "Road trip".',
    severity: "critical",
  },
  {
    action: "update",
    toolName: "spotify_update_playlist",
    params: { id: "playlist1", name: "New name" },
    title: 'Update Spotify playlist: "Road trip"',
    description: 'Update playlist "Road trip".',
    severity: "warning",
  },
  {
    action: "reorderTracks",
    toolName: "spotify_reorder_playlist_tracks",
    params: { id: "playlist1", rangeStart: 0, insertBefore: 3 },
    title: 'Reorder Spotify playlist: "Road trip"',
    description: 'Move tracks within playlist "Road trip".',
    severity: "warning",
  },
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Spotify approval hook", () => {
  it.each(protectedActions)("uses the registered config and playlist name for $action", async (testCase) => {
    const fetch = mockSpotify();
    const handler = registerHook();

    await expect(handler({ toolName: testCase.toolName, params: testCase.params })).resolves.toEqual({
      requireApproval: {
        title: testCase.title,
        description: `${testCase.description}\nhttps://open.spotify.com/playlist/playlist1`,
        severity: testCase.severity,
        allowedDecisions: ["allow-once", "deny"],
        timeoutMs: 120_000,
        timeoutReason: "Spotify playlist change was not approved in time.",
      },
    });
    expect(fetch.mock.calls.some(([input]) => String(input) === "https://api.spotify.com/v1/playlists/playlist1")).toBe(true);
    expect(fetch.mock.calls.every(([, init]) => !init?.method || ["GET", "POST"].includes(init.method))).toBe(true);
  });

  it.each([
    { label: "Spotify URI", id: "spotify:playlist:playlist1" },
    { label: "copied Spotify URL", id: "https://open.spotify.com/playlist/playlist1?si=shared" },
  ])("resolves playlist names from a $label", async ({ id }) => {
    mockSpotify();
    await expect(registerHook()({ toolName: "spotify_delete_playlist", params: { id } })).resolves.toMatchObject({
      requireApproval: { title: 'Delete Spotify playlist: "Road trip"' },
    });
  });

  it("pluralizes track removals", async () => {
    mockSpotify();
    await expect(registerHook()({
      toolName: "spotify_remove_playlist_tracks",
      params: { id: "playlist1", uris: ["track-1", "track-2"] },
    })).resolves.toMatchObject({
      requireApproval: { description: 'Remove 2 tracks from playlist "Road trip".\nhttps://open.spotify.com/playlist/playlist1' },
    });
  });

  it.each(protectedActions)("honors the registered allow setting for $action", async ({ action, toolName, params }) => {
    const fetch = mockSpotify();
    const handler = registerHook({ ...config, playlistApprovals: { [action]: "allow" } });
    await expect(handler({ toolName, params })).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses saved OAuth tokens when resolving playlist names", async () => {
    const fetch = mockSpotify();
    const handler = registerHook({ clientId: "saved-approval-client", clientSecret: "saved-approval-secret" }, {
      state: {
        openSyncKeyedStore: <T>() => ({
          register: vi.fn(),
          lookup: () => ({ refreshToken: "saved-approval-token" }) as T,
        }),
      },
    });
    await expect(handler({ toolName: "spotify_delete_playlist", params: { id: "playlist1" } })).resolves.toMatchObject({
      requireApproval: { title: 'Delete Spotify playlist: "Road trip"' },
    });
    const tokenRequest = fetch.mock.calls.find(([input]) => String(input) === "https://accounts.spotify.com/api/token");
    expect(new URLSearchParams(String(tokenRequest?.[1]?.body)).get("refresh_token")).toBe("saved-approval-token");
  });

  it("uses environment credentials when plugin config is empty", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "env-approval-client");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "env-approval-secret");
    vi.stubEnv("SPOTIFY_REFRESH_TOKEN", "env-approval-token");
    mockSpotify();
    await expect(registerHook({})({ toolName: "spotify_delete_playlist", params: { id: "playlist1" } })).resolves.toMatchObject({
      requireApproval: { title: 'Delete Spotify playlist: "Road trip"' },
    });
  });

  it.each([
    { label: "metadata lookup fails", name: "Unavailable", status: 403 },
    { label: "playlist name is blank", name: "   ", status: 200 },
  ])("keeps approval and a playlist link when $label", async ({ name, status }) => {
    mockSpotify(name, status);
    await expect(registerHook()({ toolName: "spotify_delete_playlist", params: { id: "spotify:playlist:playlist1" } })).resolves.toMatchObject({
      requireApproval: {
        title: "Delete Spotify playlist",
        description: "Remove playlist https://open.spotify.com/playlist/playlist1 from your Spotify library.\nPlaylist name unavailable; check the link before approving.",
        severity: "critical",
        allowedDecisions: ["allow-once", "deny"],
      },
    });
  });

  it("keeps malformed tool calls behind a generic approval", async () => {
    const fetch = mockSpotify();
    await expect(registerHook()({ toolName: "spotify_remove_playlist_tracks", params: { id: "playlist1", uris: [] } })).resolves.toMatchObject({
      requireApproval: { description: "Review this Spotify playlist change before it runs.", severity: "critical" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("quotes special characters in playlist names without exposing raw IDs", async () => {
    mockSpotify('  Night "drive"\nMix  ');
    await expect(registerHook()({ toolName: "spotify_delete_playlist", params: { id: "playlist1" } })).resolves.toMatchObject({
      requireApproval: {
        title: 'Delete Spotify playlist: "Night \\"drive\\"\\nMix"',
        description: 'Remove playlist "Night \\"drive\\"\\nMix" from your Spotify library.\nhttps://open.spotify.com/playlist/playlist1',
      },
    });
  });
});
