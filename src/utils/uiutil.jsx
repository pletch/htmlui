import { faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React from "react";
import { sizeDisplayName } from "./formatutils.js";

export function sizeWithFailures(size, summ, bytesStringBase2) {
  if (size === undefined) {
    return "";
  }

  if (!summ || !summ.errors || !summ.numFailed) {
    return <span>{sizeDisplayName(size, bytesStringBase2)}</span>;
  }

  let caption = "Encountered " + summ.numFailed + " errors:\n\n";
  let prefix = "- ";
  if (summ.numFailed === 1) {
    caption = "Error: ";
    prefix = "";
  }

  caption += summ.errors.map((x) => prefix + x.path + ": " + x.error).join("\n");

  return (
    <span>
      {sizeDisplayName(size, bytesStringBase2)}&nbsp;
      <FontAwesomeIcon color="red" icon={faExclamationTriangle} title={caption} />
    </span>
  );
}

export const newDataBytesTitle =
  "New data the snapshot added after deduplication, before compression; unchanged files add nothing";

export const uploadedBytesTitle = "What the new data takes in the repository after compression and encryption";

/**
 * Shows a byte count with an explanation. Counts that were not recorded, as
 * for snapshots taken before kopia recorded them, show nothing.
 *
 * @param {number|undefined|null} value - the byte count
 * @param {string} title - the explanation shown as a tooltip
 * @param {boolean} bytesStringBase2 - whether to use base-2 units
 */
function recordedBytesCell(value, title, bytesStringBase2) {
  if (value === undefined || value === null || value < 0) {
    return "";
  }

  return <span title={title}>{sizeDisplayName(value, bytesStringBase2)}</span>;
}

/**
 * Shows the new data a snapshot added, before compression.
 *
 * @param {number|undefined|null} newData - the snapshot's newDataBytes
 * @param {boolean} bytesStringBase2 - whether to use base-2 units
 */
export function newDataBytesCell(newData, bytesStringBase2) {
  return recordedBytesCell(newData, newDataBytesTitle, bytesStringBase2);
}

/**
 * Shows what a snapshot's new data takes in the repository.
 *
 * @param {number|undefined|null} uploaded - the snapshot's uploadedBytes
 * @param {boolean} bytesStringBase2 - whether to use base-2 units
 */
export function uploadedBytesCell(uploaded, bytesStringBase2) {
  return recordedBytesCell(uploaded, uploadedBytesTitle, bytesStringBase2);
}

/**
 * In case of an error, redirect to the repository selection
 * @param {error} The error that was returned
 */
export function redirect(e) {
  if (e && e.response && e.response.data && e.response.data.code === "NOT_CONNECTED") {
    window.location.replace("/repo");
  }
}

export function errorAlert(err, prefix) {
  if (!prefix) {
    prefix = "Error";
  }

  prefix += ": ";

  if (err.response && err.response.data && err.response.data.error) {
    alert(prefix + err.response.data.error);
  } else if (err instanceof Error) {
    alert(err);
  } else {
    alert(prefix + JSON.stringify(err));
  }
}

export function toAlgorithmOption(x, defaultID) {
  let text = x.id;

  if (x.id === defaultID) {
    text = x.id + " (RECOMMENDED)";
  }

  if (x.deprecated) {
    text = x.id + " (NOT RECOMMENDED)";
  }

  return (
    <option key={x.id} value={x.id}>
      {text}
    </option>
  );
}

/**
 * Renders the size of a snapshot. A disk image's files are as large as its
 * partitions, free space included, so for an image the server reports the
 * used space read from its disks (imageBytesRead), which is shown instead,
 * with the size of the disks in the tooltip.
 *
 * @param {number|undefined|null} imageBytesRead - the snapshot's imageBytesRead
 * @param {number|undefined} totalSize - the total size of the snapshot's files
 * @param {object|null} summ - the directory summary, for errors
 * @param {boolean} bytesStringBase2 - whether to use base-2 units
 */
export function snapshotSizeCell(imageBytesRead, totalSize, summ, bytesStringBase2) {
  if (imageBytesRead === undefined || imageBytesRead === null) {
    return sizeWithFailures(totalSize, summ, bytesStringBase2);
  }

  const title =
    "Used space read from the disks. The image restores " +
    sizeDisplayName(totalSize ?? 0, bytesStringBase2) +
    " of partitions, free space included.";

  return <span title={title}>{sizeDisplayName(imageBytesRead, bytesStringBase2)}</span>;
}
