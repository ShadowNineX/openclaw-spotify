import type { Static, TSchema } from "typebox";
import { Check } from "typebox/value";

import type { SpotifyPluginConfig } from "./index";
import { getSpotifyUserClient, type SpotifyRuntimeApi } from "./spotify";
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
  timeoutBehavior: "deny";
};

type SpotifyToolApprovalResult =
  | {
      requireApproval: SpotifyApprovalRequest;
    }
  | undefined;

export type SpotifyToolCallEvent = {
  context?: {
    pluginConfig?: SpotifyPluginConfig;
  };
  toolName: string;
  params?: unknown;
};

export type SpotifyApprovalApi = {
  on(
    event: "before_tool_call",
    handler: (
      event: SpotifyToolCallEvent,
    ) => SpotifyToolApprovalResult | Promise<SpotifyToolApprovalResult>,
  ): void;
} & SpotifyRuntimeApi;

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
    `Remove ${params.uris.length} track(s) from playlist ${playlistLabel}.`,
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
    `Delete playlist ${playlistLabel} from the authorized user's library.`,
} satisfies SpotifyApprovalPolicy<typeof deletePlaylistSchema>;

export function registerSpotifyApprovalPolicy(api: SpotifyApprovalApi): void {
  api.on("before_tool_call", (event) => buildSpotifyToolApproval(event, api));
}

export async function buildSpotifyToolApproval(
  event: SpotifyToolCallEvent,
  api?: SpotifyRuntimeApi,
): Promise<SpotifyToolApprovalResult> {
  switch (event.toolName) {
    case "spotify_update_playlist":
      return buildApproval(
        event.params,
        event.context?.pluginConfig,
        api,
        UPDATE_PLAYLIST_POLICY,
      );
    case "spotify_remove_playlist_tracks":
      return buildApproval(
        event.params,
        event.context?.pluginConfig,
        api,
        REMOVE_PLAYLIST_TRACKS_POLICY,
      );
    case "spotify_reorder_playlist_tracks":
      return buildApproval(
        event.params,
        event.context?.pluginConfig,
        api,
        REORDER_PLAYLIST_TRACKS_POLICY,
      );
    case "spotify_delete_playlist":
      return buildApproval(
        event.params,
        event.context?.pluginConfig,
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

  if (Check(policy.schema, params)) {
    const playlistLabel = await resolvePlaylistLabel(params.id, config, api);
    description = policy.describe(params, playlistLabel);
  }

  return {
    requireApproval: {
      title: policy.title,
      description,
      severity: policy.severity,
      allowedDecisions: ["allow-once", "deny"],
      timeoutMs: 120_000,
      timeoutBehavior: "deny",
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
): Promise<string> {
  if (!config) {
    return id;
  }

  try {
    const client = getSpotifyUserClient(config, api);
    const playlist = await client.playlists.get(id);

    return formatPlaylistLabel(id, playlist.name);
  } catch {
    return id;
  }
}

function formatPlaylistLabel(id: string, playlistName: string | undefined): string {
  const name = playlistName?.trim();

  return name ? `"${name}" (id: ${id})` : id;
}
