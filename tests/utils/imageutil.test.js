import { describe, expect, test } from "vitest";
import {
  diskGUIDOf,
  diskMapTiles,
  isImageSource,
  parseVolumeEntry,
  partitionTypeName,
  usedBytes,
} from "../../src/utils/imageutil";
import { groupImagesByDisk, pathInMount } from "../../src/pages/Images";

describe("imageutil", () => {
  test("tells image sources from folders", () => {
    expect(isImageSource({ path: "image:disk:abc" })).toBe(true);
    expect(isImageSource({ path: "C:\\Users" })).toBe(false);
    expect(isImageSource(undefined)).toBe(false);
    expect(diskGUIDOf({ path: "image:disk:abc" })).toBe("abc");
    expect(diskGUIDOf({ path: "/home" })).toBe("");
  });

  test("parses volume image names", () => {
    expect(parseVolumeEntry("p4-C.img")).toEqual({ folder: "p4-C", partition: 4, letter: "C:", label: "C" });
    expect(parseVolumeEntry("p1.img")).toEqual({ folder: "p1", partition: 1, letter: "", label: "" });
    expect(parseVolumeEntry("p5-recovery.img")).toEqual({
      folder: "p5-recovery",
      partition: 5,
      letter: "",
      label: "recovery",
    });
  });

  test("names partition types", () => {
    expect(partitionTypeName("C12A7328-F81F-11D2-BA4B-00A0C93EC93B")).toBe("EFI System");
    expect(partitionTypeName("de94bba4-06d1-4d40-a16a-bfd50179d6ac")).toBe("Recovery");
    expect(partitionTypeName("00000000-0000-0000-0000-000000000001")).toBe("Other");
  });

  test("builds the disk map from the layout, or from the volumes without one", () => {
    const v3 = { entryName: "p3-C.img", partitionNumber: 3, kind: "ntfs", size: 100, freeBytes: 40 };
    const withLayout = diskMapTiles({
      volumes: [v3],
      partitions: [
        { number: 1, typeGuid: "x", length: 10 },
        { number: 3, typeGuid: "y", length: 100 },
      ],
    });
    expect(withLayout.map((t) => [t.number, t.volume])).toEqual([
      [1, null],
      [3, v3],
    ]);

    expect(diskMapTiles({ volumes: [v3] })).toEqual([{ number: 3, name: "", typeGuid: "", length: 100, volume: v3 }]);
    expect(usedBytes(v3)).toBe(60);
    expect(usedBytes(null)).toBe(0);
  });

  test("groups images by disk, keeping their order", () => {
    const src = (p, host = "pc") => ({ host, userName: "u", path: p });
    const groups = groupImagesByDisk([
      { id: 1, source: src("image:disk:a") },
      { id: 2, source: src("image:disk:a") },
      { id: 3, source: src("image:disk:b") },
      { id: 4, source: src("image:disk:a", "laptop") },
    ]);

    expect(groups.map((g) => g.images.map((i) => i.id))).toEqual([[1, 2], [3], [4]]);
  });

  test("joins folders to mount paths", () => {
    expect(pathInMount("K:", "p4-C")).toBe("K:\\p4-C");
    expect(pathInMount("K:\\", "p4-C")).toBe("K:\\p4-C");
    expect(pathInMount("/tmp/kopia-mount1", "p4-C")).toBe("/tmp/kopia-mount1/p4-C");
    expect(pathInMount("K:")).toBe("K:");
  });
});
