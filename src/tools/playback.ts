import type { SpotifyApi } from "@spotify/web-api-ts-sdk";

import {
  getSpotifyUserClient,
  normalizeSpotifyContextUri,
  normalizeSpotifyPlayableUri,
  resolveSpotifyMarket,
  summarizeDevice,
  summarizePlaybackState,
  summarizeQueue,
} from "../spotify";
import {
  playbackDeviceSchema,
  playbackPlaySchema,
  playbackQueueAddSchema,
  playbackReadSchema,
  playbackRepeatSchema,
  playbackSeekSchema,
  playbackShuffleSchema,
  playbackTransferSchema,
  playbackVolumeSchema,
} from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function definePlaybackTools(tool: SpotifyToolFactory): SpotifyTool[] {
  return [
    tool({
      name: "spotify_get_playback",
      label: "Spotify Playback",
      description:
        "Get the authorized user's current Spotify playback state and active item.",
      parameters: playbackReadSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);
        const playback = await sdk.player.getPlaybackState(
          resolveSpotifyMarket(params.market, config),
          "episode",
        );

        return summarizePlaybackState(playback);
      },
    }),
    tool({
      name: "spotify_get_currently_playing",
      label: "Spotify Currently Playing",
      description: "Get the authorized user's currently playing Spotify item.",
      parameters: playbackReadSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);
        const playback = await sdk.player.getCurrentlyPlayingTrack(
          resolveSpotifyMarket(params.market, config),
          "episode",
        );

        return summarizePlaybackState(playback);
      },
    }),
    tool({
      name: "spotify_list_devices",
      label: "Spotify Devices",
      description:
        "List the authorized user's available Spotify Connect devices.",
      parameters: playbackDeviceSchema,
      async execute(_params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);
        const devices = await sdk.player.getAvailableDevices();

        return {
          devices: devices.devices.map((device) => summarizeDevice(device)),
        };
      },
    }),
    tool({
      name: "spotify_get_queue",
      label: "Spotify Queue",
      description: "Get the authorized user's Spotify playback queue.",
      parameters: playbackDeviceSchema,
      async execute(_params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);
        const queue = await sdk.player.getUsersQueue();

        return summarizeQueue(queue);
      },
    }),
    tool({
      name: "spotify_transfer_playback",
      label: "Spotify Transfer Playback",
      description: "Transfer Spotify playback to a Spotify Connect device.",
      parameters: playbackTransferSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);

        await sdk.player.transferPlayback([params.deviceId], params.play);

        return {
          deviceId: params.deviceId,
          transferred: true,
          play: params.play,
        };
      },
    }),
    tool({
      name: "spotify_play",
      label: "Spotify Play",
      description:
        "Start or resume Spotify playback, optionally with a context or specific tracks.",
      parameters: playbackPlaySchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);
        const contextUri = params.contextUri
          ? normalizeSpotifyContextUri(params.contextUri)
          : undefined;
        const uris = params.uris?.map((uri) =>
          normalizeSpotifyPlayableUri(uri),
        );

        if (contextUri && uris) {
          throw new Error(
            "Spotify playback can use either contextUri or uris, not both.",
          );
        }

        await makePlayerRequest(sdk, "PUT", "me/player/play", {
          query: { device_id: params.deviceId },
          body: {
            context_uri: contextUri,
            uris,
            position_ms: params.positionMs,
          },
        });

        return {
          playing: true,
          deviceId: params.deviceId,
          contextUri,
          uris,
          positionMs: params.positionMs,
        };
      },
    }),
    tool({
      name: "spotify_pause",
      label: "Spotify Pause",
      description: "Pause Spotify playback.",
      parameters: playbackDeviceSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);

        await makePlayerRequest(sdk, "PUT", "me/player/pause", {
          query: { device_id: params.deviceId },
        });

        return {
          paused: true,
          deviceId: params.deviceId,
        };
      },
    }),
    tool({
      name: "spotify_next",
      label: "Spotify Next",
      description: "Skip to the next Spotify playback item.",
      parameters: playbackDeviceSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);

        await makePlayerRequest(sdk, "POST", "me/player/next", {
          query: { device_id: params.deviceId },
        });

        return {
          skipped: "next",
          deviceId: params.deviceId,
        };
      },
    }),
    tool({
      name: "spotify_previous",
      label: "Spotify Previous",
      description: "Skip to the previous Spotify playback item.",
      parameters: playbackDeviceSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);

        await makePlayerRequest(sdk, "POST", "me/player/previous", {
          query: { device_id: params.deviceId },
        });

        return {
          skipped: "previous",
          deviceId: params.deviceId,
        };
      },
    }),
    tool({
      name: "spotify_seek",
      label: "Spotify Seek",
      description: "Seek Spotify playback to a position in milliseconds.",
      parameters: playbackSeekSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);

        await makePlayerRequest(sdk, "PUT", "me/player/seek", {
          query: {
            position_ms: params.positionMs,
            device_id: params.deviceId,
          },
        });

        return {
          positionMs: params.positionMs,
          deviceId: params.deviceId,
        };
      },
    }),
    tool({
      name: "spotify_set_repeat",
      label: "Spotify Repeat",
      description: "Set Spotify repeat mode.",
      parameters: playbackRepeatSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);

        await sdk.player.setRepeatMode(params.state, params.deviceId);

        return {
          repeat: params.state,
          deviceId: params.deviceId,
        };
      },
    }),
    tool({
      name: "spotify_set_volume",
      label: "Spotify Volume",
      description: "Set Spotify playback volume from 0 to 100.",
      parameters: playbackVolumeSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);

        await sdk.player.setPlaybackVolume(
          params.volumePercent,
          params.deviceId,
        );

        return {
          volumePercent: params.volumePercent,
          deviceId: params.deviceId,
        };
      },
    }),
    tool({
      name: "spotify_set_shuffle",
      label: "Spotify Shuffle",
      description: "Enable or disable Spotify shuffle.",
      parameters: playbackShuffleSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);

        await sdk.player.togglePlaybackShuffle(params.state, params.deviceId);

        return {
          shuffle: params.state,
          deviceId: params.deviceId,
        };
      },
    }),
    tool({
      name: "spotify_add_to_queue",
      label: "Spotify Add To Queue",
      description: "Add a Spotify track or episode to the playback queue.",
      parameters: playbackQueueAddSchema,
      async execute(params, config, context) {
        const sdk = getSpotifyUserClient(config, context.api);
        const uri = normalizeSpotifyPlayableUri(params.uri);

        await sdk.player.addItemToPlaybackQueue(uri, params.deviceId);

        return {
          queued: true,
          uri,
          deviceId: params.deviceId,
        };
      },
    }),
  ];
}

async function makePlayerRequest(
  sdk: SpotifyApi,
  method: "POST" | "PUT",
  path: string,
  options: {
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(options.query ?? {})) {
    appendQueryParam(query, key, value);
  }

  const queryString = query.size > 0 ? `?${query.toString()}` : "";
  const body = stripUndefinedValues(options.body);

  await sdk.makeRequest(method, `${path}${queryString}`, body);
}

function appendQueryParam(
  query: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    throw new TypeError(`Invalid Spotify player query parameter: ${key}`);
  }

  query.set(key, value.toString());
}

function stripUndefinedValues(
  body: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!body) {
    return undefined;
  }

  const next = Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  );

  return Object.keys(next).length > 0 ? next : undefined;
}
