import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";

import {
  startSpotifyOauthFlow,
  waitForSpotifyOauthFlowCompletion,
} from "./oauth-flow";
import { SPOTIFY_USER_SCOPES, type SpotifyPluginConfig } from "./spotify";

type RegisterSpotifyCliOptions = {
  api: OpenClawPluginApi;
  config: OpenClawConfig;
  program: Parameters<OpenClawPluginApi["registerCli"]>[0] extends (
    context: infer TContext,
  ) => unknown
    ? TContext extends { program: infer TProgram }
      ? TProgram
      : never
    : never;
};

type SpotifyAuthLoginOptions = {
  timeout?: number;
};

export function registerSpotifyCli({
  api,
  config,
  program,
}: RegisterSpotifyCliOptions): void {
  const spotify = program
    .command("spotify")
    .description("Manage the OpenClaw Spotify plugin");
  const auth = spotify.command("auth").description("Manage Spotify OAuth");

  auth
    .command("login")
    .description("Start Spotify OAuth and save the refresh token to OpenClaw")
    .option(
      "--timeout <seconds>",
      "How long to keep the local callback server open",
      parseTimeoutSeconds,
      300,
    )
    .action(async (options: unknown) => {
      if (!isSpotifyAuthLoginOptions(options)) {
        throw new Error("Invalid Spotify auth login options.");
      }

      await runSpotifyAuthLogin(api, config, options);
    });
}

async function runSpotifyAuthLogin(
  api: OpenClawPluginApi,
  config: OpenClawConfig,
  options: SpotifyAuthLoginOptions,
): Promise<void> {
  const timeoutSeconds = options.timeout ?? 300;
  const flow = await startSpotifyOauthFlow(resolveSpotifyPluginConfig(config), {
    api,
    scopes: SPOTIFY_USER_SCOPES,
    timeoutSeconds,
  });

  console.log("Spotify OAuth login started.");
  console.log("");
  console.log(
    "If OpenClaw is running on a VPS, make sure this port forward exists from your local machine:",
  );
  console.log("  ssh -L 4377:127.0.0.1:4377 user@your-vps");
  console.log("");
  console.log("Then open this authorization URL in your local browser:");
  console.log(flow.authorizationUrl);
  console.log("");
  console.log(`Waiting for Spotify to redirect to ${flow.callbackUrl} ...`);

  const completed = await waitForSpotifyOauthFlowCompletion(timeoutSeconds);

  if (!completed.persisted) {
    throw new Error(
      `Spotify OAuth completed, but the refresh token could not be saved to OpenClaw: ${completed.error ?? "unknown error"}`,
    );
  }

  console.log(
    `Spotify OAuth complete. Refresh token saved via ${completed.storage}.`,
  );
}

function resolveSpotifyPluginConfig(
  config: OpenClawConfig,
): SpotifyPluginConfig {
  const pluginConfig = readPath(config as Record<string, unknown>, [
    "plugins",
    "entries",
    "spotify",
    "config",
  ]);

  return isRecord(pluginConfig) ? pluginConfig : {};
}

function readPath(
  root: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = root;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function parseTimeoutSeconds(value: string): number {
  const timeout = Number(value);

  if (!Number.isInteger(timeout)) {
    throw new TypeError("Timeout must be an integer number of seconds.");
  }

  return timeout;
}

function isSpotifyAuthLoginOptions(
  value: unknown,
): value is SpotifyAuthLoginOptions {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
