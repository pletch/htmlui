// Helpers for disk images (kopia image), whose snapshots have sources such as
// "image:disk:<GPT disk GUID>".

export const imageSourcePrefix = "image:";
export const diskSourcePrefix = "image:disk:";

/** Tells whether a snapshot source is a disk image rather than a folder. */
export function isImageSource(source) {
  return !!source?.path?.startsWith(imageSourcePrefix);
}

/** Returns the GPT disk GUID of a disk image source, or "" for other sources. */
export function diskGUIDOf(source) {
  return source?.path?.startsWith(diskSourcePrefix) ? source.path.substring(diskSourcePrefix.length) : "";
}

// GPT partition types that Windows disks use, by type GUID.
const partitionTypes = {
  "c12a7328-f81f-11d2-ba4b-00a0c93ec93b": "EFI System",
  "e3c9e316-0b5c-4db8-817d-f92df00215ae": "Microsoft Reserved",
  "ebd0a0a2-b9e5-4433-87c0-68b6b72699c7": "Basic Data",
  "de94bba4-06d1-4d40-a16a-bfd50179d6ac": "Recovery",
};

/** Returns the name of a GPT partition type, or "Other" for one Windows does not use. */
export function partitionTypeName(typeGuid) {
  return partitionTypes[(typeGuid || "").toLowerCase()] || "Other";
}

/**
 * Parses the name of a volume image such as "p4-C.img": the partition number,
 * the drive letter it had (if any) and the folder that shows its files when
 * the image is mounted ("p4-C").
 */
export function parseVolumeEntry(entryName) {
  const folder = (entryName || "").replace(/\.img$/, "");
  const m = /^p(\d+)(?:-(.+))?$/.exec(folder);

  return {
    folder,
    partition: m ? Number(m[1]) : 0,
    letter: m && m[2] && /^[A-Za-z]$/.test(m[2]) ? m[2].toUpperCase() + ":" : "",
    label: m && m[2] ? m[2] : "",
  };
}

/**
 * Returns the tiles of an image's disk map, one per partition in disk order:
 * every partition of the layout with the volume image saved for it, if any.
 * Images without a layout show their volumes only.
 */
export function diskMapTiles(image) {
  const volumes = image.volumes || [];
  const byPartition = new Map(volumes.map((v) => [v.partitionNumber, v]));

  if (!image.partitions || image.partitions.length === 0) {
    return volumes.map((v) => ({ number: v.partitionNumber, name: "", typeGuid: "", length: v.size, volume: v }));
  }

  return image.partitions.map((p) => ({ ...p, volume: byPartition.get(p.number) || null }));
}

/**
 * Returns how much of a volume image holds data: an NTFS volume's used
 * clusters, or the whole partition for volumes imaged as raw bytes.
 */
export function usedBytes(volume) {
  if (!volume) {
    return 0;
  }

  return Math.max(volume.size - (volume.freeBytes || 0), 0);
}
