import React from "react";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import PropTypes from "prop-types";
import { PolicyEditor } from "./policy-editor/PolicyEditor";
import { computerName, useKnownComputers } from "./RepositoryDefaults";

/**
 * The tabs of the File Snapshots page that edit settings: each shows some
 * sections of a policy that only file snapshots use, of all the computers or
 * of one of them. Retention, which disk images share, is set on Repository ›
 * Defaults, and a folder's own settings on its Policy tab. The folders that
 * are backed up are listed on the page's Folders tab.
 */
export const fileSettingsTabs = [
  {
    key: "exclusions",
    title: "Exclusions",
    sections: ["files"],
    intro:
      "The files and folders to skip inside every folder that is backed up. The folders themselves are listed on the Folders tab.",
  },
  { key: "schedule", title: "Schedule", sections: ["scheduling"] },
  { key: "actions", title: "Actions", sections: ["snapshot-actions", "folder-actions"] },
  { key: "advanced", title: "Advanced", sections: ["compression", "errors", "upload", "logging"] },
];

/** The choice of the settings of all the computers, in the computer picker. */
export const allComputers = "all";

const globalTarget = { userName: "", host: "", path: "" };

/**
 * Edits some sections of a policy in place: of all the computers (the global
 * policy), or of one computer, whose empty settings are those of all.
 * target is the key of the computer chosen, or allComputers; null chooses
 * this computer.
 */
export function FileSnapshotSettings({ sections, intro, target, onTarget }) {
  const computers = useKnownComputers();

  if (!computers) {
    return <Spinner animation="border" size="sm" />;
  }

  const chosen = computers.list.find((c) => c.key === (target ?? computers.local?.key));
  const key = chosen ? chosen.key : allComputers;
  const source = chosen ? chosen.target : globalTarget;
  const name = chosen && computerName(chosen.target);

  return (
    <>
      {intro && <p data-testid="file-settings-intro">{intro}</p>}
      <Row className="mb-2 align-items-center">
        <Form.Label column xs="auto" htmlFor="file-settings-for">
          Settings for
        </Form.Label>
        <Col xs="auto">
          <Form.Select
            id="file-settings-for"
            size="sm"
            value={key}
            onChange={(e) => onTarget(e.target.value)}
            data-testid="file-settings-for"
          >
            <option value={allComputers}>All computers</option>
            {computers.list.map((c) => (
              <option key={c.key} value={c.key}>
                {computerName(c.target)}
                {c.local ? " (this computer)" : ""}
              </option>
            ))}
          </Form.Select>
        </Col>
      </Row>
      <p data-testid="file-settings-scope">
        {chosen ? (
          <>
            These settings apply to the file snapshots of {name} only; the ones it leaves empty are those of all
            computers.
          </>
        ) : (
          <>
            These settings apply to the file snapshots of every computer that uses this repository, unless a computer
            has its own.
          </>
        )}{" "}
        Disk images do not use them. To use different settings for one folder, open it from the Folders tab and use its
        Policy tab.
      </p>
      <PolicyEditor key={key} userName={source.userName} host={source.host} path="" sections={sections} />
    </>
  );
}

FileSnapshotSettings.propTypes = {
  sections: PropTypes.arrayOf(PropTypes.string).isRequired,
  intro: PropTypes.string,
  target: PropTypes.string,
  onTarget: PropTypes.func.isRequired,
};
