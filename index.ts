import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import {
  SPOTIFY_PLUGIN_DESCRIPTION,
  SPOTIFY_PLUGIN_ID,
  SPOTIFY_PLUGIN_NAME,
  spotifyConfigSchema,
} from "./src/index";
import { registerSpotifyCli } from "./src/cli";
import { defineSpotifyTools } from "./src/tools/index";

const entry = defineToolPlugin({
  id: SPOTIFY_PLUGIN_ID,
  name: SPOTIFY_PLUGIN_NAME,
  description: SPOTIFY_PLUGIN_DESCRIPTION,
  configSchema: spotifyConfigSchema,
  tools: defineSpotifyTools,
});
const registerTools = entry.register;

entry.register = (api) => {
  api.registerCli(
    ({ config, program }) => {
      registerSpotifyCli({
        api,
        config,
        program,
      });
    },
    {
      descriptors: [
        {
          name: "spotify",
          description: "Manage the OpenClaw Spotify plugin",
          hasSubcommands: true,
        },
      ],
    },
  );

  if (api.registrationMode === "cli-metadata") {
    return;
  }

  registerTools(api);
};

export default entry;
