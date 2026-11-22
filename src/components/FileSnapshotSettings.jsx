import React from "react";
import PropTypes from "prop-types";
import { PolicyEditor } from "./policy-editor/PolicyEditor";

/**
 * The tabs of the File Snapshots page that edit settings: each shows some
 * sections of the global policy, which only file snapshots use. Retention,
 * which disk images share, has no sections: it edits this computer's policy.
 */
export const fileSettingsTabs = [
  { key: "backup", title: "What to Back Up", sections: ["files"] },
  { key: "schedule", title: "Schedule", sections: ["scheduling"] },
  { key: "retention", title: "Retention" },
  { key: "actions", title: "Actions", sections: ["snapshot-actions", "folder-actions"] },
  { key: "advanced", title: "Advanced", sections: ["compression", "errors", "upload", "logging"] },
];

/** Edits some sections of the global policy, in place. */
export function FileSnapshotSettings({ sections }) {
  return (
    <>
      <p data-testid="file-settings-scope">
        These settings apply to the file snapshots of every computer that uses this repository; disk images do not use
        them. To use different settings for one folder, open it from the Snapshots tab and use its Policy tab.
      </p>
      <PolicyEditor userName="" host="" path="" sections={sections} />
    </>
  );
}

FileSnapshotSettings.propTypes = {
  sections: PropTypes.arrayOf(PropTypes.string).isRequired,
};
