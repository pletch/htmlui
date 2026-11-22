import React from "react";
import Alert from "react-bootstrap/Alert";
import PropTypes from "prop-types";
import { Link } from "react-router";
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

/** Lists the retention of every disk that has images. */
export function ImageRetention({ disks, titleOf }) {
  return (
    <>
      <p>
        Retention decides which images of a disk are kept. Every image run applies it when it ends, and the space of the
        images it deletes is freed when the repository&apos;s full maintenance runs. Empty settings are inherited from
        this computer&apos;s settings when it has some, otherwise from the{" "}
        <Link to="/repo?tab=defaults">repository defaults</Link>. Keep weekly and monthly images too, to be able to go
        back to before an infection that waited to strike.
      </p>
      {disks.length === 0 ? (
        <Alert variant="info">Retention can be set for a disk once it has an image.</Alert>
      ) : (
        disks.map((d) => <DiskRetention key={d.key} source={d.source} title={titleOf(d.source)} />)
      )}
    </>
  );
}

ImageRetention.propTypes = {
  disks: PropTypes.array.isRequired,
  titleOf: PropTypes.func.isRequired,
};
