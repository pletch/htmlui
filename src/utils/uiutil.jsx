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
