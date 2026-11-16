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

export const uploadedBytesTitle =
  "New data the snapshot stored after deduplication, compression and encryption; unchanged files add nothing";

/**
 * Shows the bytes a snapshot uploaded. Snapshots taken before kopia
 * recorded it have none, and show nothing.
 *
 * @param {number|undefined|null} uploaded - the snapshot's uploadedBytes
 * @param {boolean} bytesStringBase2 - whether to use base-2 units
 */
export function uploadedBytesCell(uploaded, bytesStringBase2) {
  if (uploaded === undefined || uploaded === null || uploaded < 0) {
    return "";
  }

  return <span title={uploadedBytesTitle}>{sizeDisplayName(uploaded, bytesStringBase2)}</span>;
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
