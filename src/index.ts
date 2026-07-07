import { Type } from "typebox";

export const SPOTIFY_PLUGIN_ID = "spotify";
export const SPOTIFY_PLUGIN_NAME = "Spotify";
export const SPOTIFY_PLUGIN_DESCRIPTION =
  "Spotify integration plugin for OpenClaw";

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
          "Spotify OAuth refresh token for user-library and playlist write tools. Falls back to SPOTIFY_REFRESH_TOKEN, then the token saved by spotify_oauth_start.",
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
  },
  { additionalProperties: false },
);
