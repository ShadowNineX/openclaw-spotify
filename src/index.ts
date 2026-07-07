import { Type, type Static } from "typebox";

export const SPOTIFY_PLUGIN_ID = "spotify";
export const SPOTIFY_PLUGIN_NAME = "Spotify";
export const SPOTIFY_PLUGIN_DESCRIPTION =
  "Spotify integration plugin for OpenClaw";

const playlistApprovalDecisionSchema = Type.Union([
  Type.Literal("prompt"),
  Type.Literal("allow"),
]);

export const spotifyConfigSchema = Type.Object(
  {
    clientId: Type.Optional(
      Type.String({
        description:
          "Spotify application client ID. Falls back to SPOTIFY_CLIENT_ID.",
      }),
    ),
    clientSecret: Type.Optional(
      Type.String({
        description:
          "Spotify application client secret. Falls back to SPOTIFY_CLIENT_SECRET.",
      }),
    ),
    refreshToken: Type.Optional(
      Type.String({
        description:
          "Manual Spotify OAuth refresh token fallback for user-library and playlist write tools. Tokens saved by `openclaw spotify auth login` are preferred over this value.",
      }),
    ),
    redirectUri: Type.Optional(
      Type.String({
        description:
          "Spotify OAuth redirect URI for generating and exchanging PKCE authorization codes. Falls back to SPOTIFY_REDIRECT_URI, then http://127.0.0.1:4377/callback.",
      }),
    ),
    market: Type.Optional(
      Type.String({
        description:
          "Default ISO 3166-1 alpha-2 market code for market-scoped Spotify requests.",
        minLength: 2,
        maxLength: 2,
      }),
    ),
    playlistApprovals: Type.Optional(
      Type.Object(
        {
          update: Type.Optional(playlistApprovalDecisionSchema),
          removeTracks: Type.Optional(playlistApprovalDecisionSchema),
          reorderTracks: Type.Optional(playlistApprovalDecisionSchema),
          delete: Type.Optional(playlistApprovalDecisionSchema),
        },
        {
          additionalProperties: false,
          description:
            "Per-action Spotify playlist approval policy. Each action defaults to prompt; set an action to allow to run it without plugin approval.",
        },
      ),
    ),
  },
  { additionalProperties: false },
);

export type SpotifyPluginConfig = Static<typeof spotifyConfigSchema>;
