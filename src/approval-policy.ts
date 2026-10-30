import type { Static, TSchema } from "typebox";
import { Check } from "typebox/value";

import type { SpotifyPluginConfig } from "./index";
import {
  getSpotifyUserClient,
  normalizeSpotifyPlaylistId,
  type SpotifyRuntimeApi,
} from "./spotify";
import {
  deletePlaylistSchema,
  playlistTracksEditSchema,
  reorderPlaylistTracksSchema,
  updatePlaylistSchema,
} from "./tools/schemas";

type SpotifyApprovalDecision = "allow-once" | "allow-always" | "deny";
type SpotifyApprovalSeverity = "warning" | "critical";

type SpotifyApprovalRequest = {
  title: string;
  description: string;
  severity: SpotifyApprovalSeverity;
  allowedDecisions: SpotifyApprovalDecision[];
  timeoutMs: number;
  timeoutReason: string;
};

type SpotifyToolApprovalResult =
  | {
      requireApproval: SpotifyApprovalRequest;
    }
  | undefined;

export type SpotifyToolCallEvent = {
  toolName: string;
  params?: unknown;
};

type SpotifyApprovalRuntimeApi = SpotifyRuntimeApi & {
  pluginConfig?: SpotifyPluginConfig;
};

export type SpotifyApprovalApi = SpotifyApprovalRuntimeApi & {
  on(
    event: "before_tool_call",
    handler: (
      event: SpotifyToolCallEvent,
    ) => SpotifyToolApprovalResult | Promise<SpotifyToolApprovalResult>,
  ): void;
};

type SpotifyApprovalPolicy<Schema extends TSchema> = {
  action: SpotifyPlaylistApprovalAction;
  schema: Schema;
  title: string;
  severity: SpotifyApprovalSeverity;
  describe(params: Static<Schema>, playlistLabel: string): string;
};

type SpotifyPlaylistApprovalAction =
  | "update"
  | "removeTracks"
  | "reorderTracks"
  | "delete";

const UPDATE_PLAYLIST_POLICY = {
  action: "update",
  schema: updatePlaylistSchema,
  title: "Update Spotify playlist",
  severity: "warning",
  describe: (_params, playlistLabel) => `Update playlist ${playlistLabel}.`,
} satisfies SpotifyApprovalPolicy<typeof updatePlaylistSchema>;

const REMOVE_PLAYLIST_TRACKS_POLICY = {
  action: "removeTracks",
  schema: playlistTracksEditSchema,
  title: "Remove tracks from Spotify playlist",
  severity: "critical",
  describe: (params, playlistLabel) =>
    `Remove ${params.uris.length} ${params.uris.length === 1 ? "track" : "tracks"} from playlist ${playlistLabel}.`,
} satisfies SpotifyApprovalPolicy<typeof playlistTracksEditSchema>;

const REORDER_PLAYLIST_TRACKS_POLICY = {
  action: "reorderTracks",
  schema: reorderPlaylistTracksSchema,
  title: "Reorder Spotify playlist",
  severity: "warning",
  describe: (_params, playlistLabel) =>
    `Move tracks within playlist ${playlistLabel}.`,
} satisfies SpotifyApprovalPolicy<typeof reorderPlaylistTracksSchema>;

const DELETE_PLAYLIST_POLICY = {
  action: "delete",
  schema: deletePlaylistSchema,
  title: "Delete Spotify playlist",
  severity: "critical",
  describe: (_params, playlistLabel) =>
    `Remove playlist ${playlistLabel} from your Spotify library.`,
} satisfies SpotifyApprovalPolicy<typeof deletePlaylistSchema>;

export function registerSpotifyApprovalPolicy(api: SpotifyApprovalApi): void {
  api.on("before_tool_call", (event) => buildSpotifyToolApproval(event, api));
}

export async function buildSpotifyToolApproval(
  event: SpotifyToolCallEvent,
  api?: SpotifyApprovalRuntimeApi,
): Promise<SpotifyToolApprovalResult> {
  // Typed api.on hooks carry config on the registration API, not event.context.
  const config = api?.pluginConfig;

  switch (event.toolName) {
    case "spotify_update_playlist":
      return buildApproval(
        event.params,
        config,
        api,
        UPDATE_PLAYLIST_POLICY,
      );
    case "spotify_remove_playlist_tracks":
      return buildApproval(
        event.params,
        config,
        api,
        REMOVE_PLAYLIST_TRACKS_POLICY,
      );
    case "spotify_reorder_playlist_tracks":
      return buildApproval(
        event.params,
        config,
        api,
        REORDER_PLAYLIST_TRACKS_POLICY,
      );
    case "spotify_delete_playlist":
      return buildApproval(
        event.params,
        config,
        api,
        DELETE_PLAYLIST_POLICY,
      );
    default:
      return undefined;
  }
}

async function buildApproval<Schema extends TSchema>(
  params: unknown,
  config: SpotifyPluginConfig | undefined,
  api: SpotifyRuntimeApi | undefined,
  policy: SpotifyApprovalPolicy<Schema>,
): Promise<SpotifyToolApprovalResult> {
  if (resolvePlaylistApprovalMode(config, policy.action) === "allow") {
    return undefined;
  }

  let description = "Review this Spotify playlist change before it runs.";
  let title: string = policy.title;

  if (Check(policy.schema, params)) {
    const playlist = await resolvePlaylistLabel(params.id, config, api);
    title = playlist.name
      ? `${policy.title}: ${JSON.stringify(playlist.name)}`
      : policy.title;
    description = policy.describe(params, playlist.label);
    description += playlist.name
      ? `\n${playlist.url}`
      : `\nPlaylist name unavailable; check ${playlist.url ? "the link" : "the playlist ID"} before approving.`;
  }

  return {
    requireApproval: {
      title,
      description,
      severity: policy.severity,
      allowedDecisions: ["allow-once", "deny"],
      timeoutMs: 120_000,
      timeoutReason: "Spotify playlist change was not approved in time.",
    },
  };
}

function resolvePlaylistApprovalMode(
  config: SpotifyPluginConfig | undefined,
  action: SpotifyPlaylistApprovalAction,
): "prompt" | "allow" {
  return config?.playlistApprovals?.[action] ?? "prompt";
}

async function resolvePlaylistLabel(
  id: string,
  config: SpotifyPluginConfig | undefined,
  api: SpotifyRuntimeApi | undefined,
): Promise<{ label: string; name?: string; url?: string }> {
  let normalizedId: string;
  try {
    normalizedId = normalizeSpotifyPlaylistId(id);
  } catch {
    return { label: JSON.stringify(id) };
  }

  const url = `https://open.spotify.com/playlist/${normalizedId}`;
  try {
    const client = getSpotifyUserClient(config ?? {}, api);
    const playlist = await client.playlists.get(normalizedId);
    const name = playlist.name?.trim();
    return { label: name ? JSON.stringify(name) : url, name, url };
  } catch {
    return { label: url, url };
  }
}
