import { defineAddPlaylistTracksTool } from "./add-playlist-tracks";
import { defineAlbumTool } from "./album";
import { defineArtistTool } from "./artist";
import { defineCreatePlaylistTool } from "./create-playlist";
import { defineMyPlaylistsTool } from "./my-playlists";
import {
  defineOauthStartTool,
  defineOauthStatusTool,
} from "./oauth";
import { definePlaylistTool } from "./playlist";
import { defineRemovePlaylistTracksTool } from "./remove-playlist-tracks";
import { defineReorderPlaylistTracksTool } from "./reorder-playlist-tracks";
import { defineSearchTool } from "./search";
import { defineTrackTool } from "./track";
import type { SpotifyToolsBuilder } from "./types";
import { defineUpdatePlaylistTool } from "./update-playlist";

export const defineSpotifyTools: SpotifyToolsBuilder = (tool) => [
  defineSearchTool(tool),
  defineTrackTool(tool),
  defineArtistTool(tool),
  defineAlbumTool(tool),
  definePlaylistTool(tool),
  defineOauthStartTool(tool),
  defineOauthStatusTool(tool),
  defineMyPlaylistsTool(tool),
  defineCreatePlaylistTool(tool),
  defineUpdatePlaylistTool(tool),
  defineAddPlaylistTracksTool(tool),
  defineRemovePlaylistTracksTool(tool),
  defineReorderPlaylistTracksTool(tool),
];
