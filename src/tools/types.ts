import type { DefineToolPluginOptions } from "openclaw/plugin-sdk/tool-plugin";

import type { spotifyConfigSchema } from "../index";

export type SpotifyToolsBuilder = DefineToolPluginOptions<
  typeof spotifyConfigSchema
>["tools"];

export type SpotifyToolFactory = Parameters<SpotifyToolsBuilder>[0];
export type SpotifyTool = ReturnType<SpotifyToolFactory>;
