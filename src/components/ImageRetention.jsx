import React from "react";
import PropTypes from "prop-types";
import { RetentionEditor } from "./RetentionEditor";

export {
  definedBy,
  inputsFromRetention,
  retentionCommand,
  retentionFields,
  retentionFromInputs,
} from "./RetentionEditor";

/**
 * Edits the retention of one disk's images: the retention section of the
 * policy of its image source. The rest of that policy is kept as it is.
 */
export function DiskRetention({ source, title }) {
  return (
    <RetentionEditor
      source={source}
      title={title}
      ownLabel="This disk"
      selfName="this disk"
      savedText="Saved. The next image run of this disk applies it."
      testID={"retention-" + source.path}
    />
  );
}

DiskRetention.propTypes = {
  source: PropTypes.object.isRequired,
  title: PropTypes.string,
};
