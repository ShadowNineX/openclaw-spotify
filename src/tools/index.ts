import { defineAddPlaylistTracksTool } from "./add-playlist-tracks";
import { defineAlbumTool } from "./album";
import { defineArtistTool } from "./artist";
import { defineCreatePlaylistTool } from "./create-playlist";
import { defineDeletePlaylistTool } from "./delete-playlist";
import { defineMyPlaylistsTool } from "./my-playlists";
import { definePlaybackTools } from "./playback";
import { definePlaylistTool } from "./playlist";
import { defineRemovePlaylistTracksTool } from "./remove-playlist-tracks";
import { defineReorderPlaylistTracksTool } from "./reorder-playlist-tracks";
import { defineSearchTool } from "./search";
import { defineTrackTool } from "./track";
import type { SpotifyToolsBuilder } from "./types";
import { defineUpdatePlaylistTool } from "./update-playlist";
import { defineUploadPlaylistCoverTool } from "./upload-playlist-cover";

export const defineSpotifyTools: SpotifyToolsBuilder = (tool) => [
  defineSearchTool(tool),
  defineTrackTool(tool),
  defineArtistTool(tool),
  defineAlbumTool(tool),
  definePlaylistTool(tool),
  defineMyPlaylistsTool(tool),
  defineCreatePlaylistTool(tool),
  defineUpdatePlaylistTool(tool),
  defineDeletePlaylistTool(tool),
  defineAddPlaylistTracksTool(tool),
  defineRemovePlaylistTracksTool(tool),
  defineReorderPlaylistTracksTool(tool),
  defineUploadPlaylistCoverTool(tool),
  ...definePlaybackTools(tool),
];
