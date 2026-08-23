import type { CatalogObject } from "square";
import { describe, expect, it } from "vitest";

import {
  attachImageUrls,
  collectImageIds,
  extractImageUrls,
  primaryImage,
  productImages,
  sizedImage,
} from "./images";
import type { CatalogProduct, StoreProduct } from "./types";

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "ITEM_1",
    name: "Ensaymada Party Tray",
    description: null,
    imageIds: [],
    imageUrls: [],
    variants: [],
    ...overrides,
  };
}

function storeProduct(overrides: Partial<StoreProduct> = {}): StoreProduct {
  return {
    ...product(),
    slug: "ensaymada-tray",
    heroImageUrl: null,
    descriptionMd: null,
    sortOrder: 0,
    allergens: [],
    dietaryTags: [],
    rule: {
      productId: "ITEM_1",
      leadTimeDays: 1,
      orderCutoffTime: "18:00",
      allowedPickupTimes: ["16:00"],
      maxUnitsPerDay: null,
      isOrderable: true,
    },
    ...overrides,
  };
}

/** Square types nearly every catalog field as optional; these mirror the wire shape. */
function imageObject(id: string, url?: string): CatalogObject {
  return { type: "IMAGE", id, imageData: url ? { url } : {} } as CatalogObject;
}

describe("extractImageUrls", () => {
  it("maps image ids to their URLs", () => {
    const urls = extractImageUrls([
      imageObject("IMG_1", "https://cdn.example/1.jpg"),
      imageObject("IMG_2", "https://cdn.example/2.jpg"),
    ]);

    expect(urls.get("IMG_1")).toBe("https://cdn.example/1.jpg");
    expect(urls.get("IMG_2")).toBe("https://cdn.example/2.jpg");
  });

  it("ignores non-image objects and images with no URL", () => {
    const urls = extractImageUrls([
      { type: "ITEM", id: "ITEM_1" } as CatalogObject,
      imageObject("IMG_NO_URL"),
    ]);

    expect(urls.size).toBe(0);
  });
});

describe("collectImageIds", () => {
  it("de-duplicates ids shared between products", () => {
    const ids = collectImageIds([
      product({ id: "A", imageIds: ["IMG_1", "IMG_2"] }),
      product({ id: "B", imageIds: ["IMG_2", "IMG_3"] }),
    ]);

    expect(ids).toEqual(["IMG_1", "IMG_2", "IMG_3"]);
  });
});

describe("attachImageUrls", () => {
  it("preserves the item's own image order", () => {
    const [attached] = attachImageUrls(
      [product({ imageIds: ["IMG_2", "IMG_1"] })],
      new Map([
        ["IMG_1", "https://cdn.example/1.jpg"],
        ["IMG_2", "https://cdn.example/2.jpg"],
      ]),
    );

    expect(attached?.imageUrls).toEqual([
      "https://cdn.example/2.jpg",
      "https://cdn.example/1.jpg",
    ]);
  });

  it("drops ids that resolved to nothing rather than emitting a broken image", () => {
    const [attached] = attachImageUrls(
      [product({ imageIds: ["IMG_DELETED", "IMG_1"] })],
      new Map([["IMG_1", "https://cdn.example/1.jpg"]]),
    );

    expect(attached?.imageUrls).toEqual(["https://cdn.example/1.jpg"]);
  });
});

describe("productImages", () => {
  it("leads with the staff hero override", () => {
    const images = productImages(
      storeProduct({
        heroImageUrl: "/harina/hero.jpg",
        imageUrls: ["https://cdn.example/1.jpg"],
      }),
    );

    expect(images).toEqual(["/harina/hero.jpg", "https://cdn.example/1.jpg"]);
  });

  it("does not repeat a hero that is also a Square image", () => {
    const squareImage = "https://items-images-production.s3.squarecdn.com/1.jpg";
    const images = productImages(
      storeProduct({
        heroImageUrl: squareImage,
        imageUrls: [squareImage, "https://cdn.example/2.jpg"],
      }),
    );

    expect(images).toEqual([squareImage, "https://cdn.example/2.jpg"]);
  });

  it("ignores a legacy override that Next/Image cannot serve", () => {
    const images = productImages(
      storeProduct({
        heroImageUrl: "https://unconfigured.example/hero.jpg",
        imageUrls: ["https://cdn.example/square.jpg"],
      }),
    );

    expect(images).toEqual(["https://cdn.example/square.jpg"]);
  });

  it("reports no primary image for a product without photography", () => {
    expect(primaryImage(storeProduct())).toBeNull();
  });
});

describe("sizedImage", () => {
  it("requests the rendered width from Square's CDN", () => {
    expect(sizedImage("https://items-images-production.s3.squarecdn.com/a.jpg", 640)).toBe(
      "https://items-images-production.s3.squarecdn.com/a.jpg?w=640",
    );
  });

  it("leaves non-Square URLs alone", () => {
    expect(sizedImage("/harina/ube-bars.png", 640)).toBe("/harina/ube-bars.png");
  });
});
