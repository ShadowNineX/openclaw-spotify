import {
  getSpotifyOauthFlowStatus,
  startSpotifyOauthFlow,
} from "../oauth-flow";
import { SPOTIFY_USER_SCOPES } from "../spotify";
import { oauthStartSchema, oauthStatusSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineOauthStartTool(tool: SpotifyToolFactory): SpotifyTool {
  return tool({
    name: "spotify_oauth_start",
    label: "Spotify OAuth Start",
    description:
      "Start a local Spotify OAuth callback flow for playlist and playback access.",
    parameters: oauthStartSchema,
    async execute(params, config, context) {
      return startSpotifyOauthFlow(config, {
        api: context.api,
        scopes: params.scopes ?? SPOTIFY_USER_SCOPES,
        state: params.state,
        timeoutSeconds: params.timeoutSeconds,
      });
    },
  });
}

export function defineOauthStatusTool(tool: SpotifyToolFactory): SpotifyTool {
  return tool({
    name: "spotify_oauth_status",
    label: "Spotify OAuth Status",
    description:
      "Check whether the local Spotify OAuth callback flow is active or completed.",
    parameters: oauthStatusSchema,
    execute() {
      return getSpotifyOauthFlowStatus();
    },
  });
}
