import { describe, expect, it } from "vitest";

import { preparePlaylistCoverImage } from "../src/playlist-cover-image";

const ONE_PIXEL_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8QH//Z";

describe("playlist cover image preparation", () => {
  it("passes through raw JPEG base64 when processing is disabled", async () => {
    await expect(
      preparePlaylistCoverImage({
        imageBase64: ONE_PIXEL_JPEG_BASE64,
        processImage: false,
      }),
    ).resolves.toMatchObject({
      jpegBase64: ONE_PIXEL_JPEG_BASE64,
      processed: false,
      source: "base64",
    });
  });

  it("requires exactly one image source", async () => {
    await expect(preparePlaylistCoverImage({})).rejects.toThrow(
      "Provide exactly one playlist cover image source",
    );

    await expect(
      preparePlaylistCoverImage({
        imageBase64: ONE_PIXEL_JPEG_BASE64,
        imageUrl: "https://example.com/cover.jpg",
      }),
    ).rejects.toThrow("Provide exactly one playlist cover image source");
  });

  it("rejects non-JPEG base64 when processing is disabled", async () => {
    await expect(
      preparePlaylistCoverImage({
        imageBase64: Buffer.from("not a jpeg").toString("base64"),
        processImage: false,
      }),
    ).rejects.toThrow("must be JPEG");
  });
});
