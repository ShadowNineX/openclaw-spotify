import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import {
  SPOTIFY_PLUGIN_DESCRIPTION,
  SPOTIFY_PLUGIN_ID,
  SPOTIFY_PLUGIN_NAME,
  spotifyConfigSchema,
} from "./src/index";
import { defineSpotifyTools } from "./src/tools/index";

const entry = defineToolPlugin({
  id: SPOTIFY_PLUGIN_ID,
  name: SPOTIFY_PLUGIN_NAME,
  description: SPOTIFY_PLUGIN_DESCRIPTION,
  configSchema: spotifyConfigSchema,
  tools: defineSpotifyTools,
});

export default entry;
