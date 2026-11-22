import axios from "axios";
import React, { useEffect, useMemo, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import PropTypes from "prop-types";
import { Link } from "react-router";
import { RetentionEditor } from "./RetentionEditor";
import { retentionSummary } from "./RepositoryDefaults";
import { compare } from "../utils/formatutils";
import { isImageSource } from "../utils/imageutil";
import { policyEditorURL } from "../utils/policyutil";

/** Returns the policies of the folders of one user@host that set their own retention, sorted by path. */
export function folderRetentionPolicies(policies, userName, host) {
  return policies
    .filter(
      (p) =>
        p.target.host === host &&
        (p.target.userName || "") === userName &&
        p.target.path &&
        !isImageSource(p.target) &&
        retentionSummary(p.policy) !== "",
    )
    .sort((l, r) => compare(l.target.path, r.target.path));
}

function errorText(e) {
  return e?.response?.data?.error || e?.message || String(e);
}

/** Lists the folders of one user@host whose own policy sets retention. */
function FolderOverrides({ userName, host }) {
  const [policies, setPolicies] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios
      .get("/api/v1/policies")
      .then((result) => setPolicies(folderRetentionPolicies(result.data.policies || [], userName, host)))
      .catch((e) => setError(errorText(e)));
  }, [userName, host]);

  if (error) {
    return <Alert variant="danger">Unable to list the policies: {error}</Alert>;
  }

  if (!policies) {
    return <Spinner animation="border" size="sm" />;
  }

  if (policies.length === 0) {
    return <p className="text-muted">No folder has its own retention: all of them use the numbers above.</p>;
  }

  return (
    <Table size="sm" responsive className="w-auto" data-testid="folder-overrides">
      <thead>
        <tr>
          <th>Folder</th>
          <th>Retention</th>
          <th>
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {policies.map((p) => (
          <tr key={p.id || p.target.path}>
            <td>{p.target.path}</td>
            <td>{retentionSummary(p.policy)}</td>
            <td>
              <Link to={policyEditorURL(p.target)}>Edit</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

FolderOverrides.propTypes = {
  userName: PropTypes.string.isRequired,
  host: PropTypes.string.isRequired,
};

/**
 * Edits the retention of this computer's file snapshots: the retention
 * section of its user@host policy. Disk images of this computer inherit it
 * too, which the note says.
 */
export function FileRetention({ userName, host }) {
  const name = userName + "@" + host;
  // kept the same across renders: the editor resolves the policy again whenever it changes
  const source = useMemo(() => ({ userName, host, path: "" }), [userName, host]);

  return (
    <>
      <p>
        Retention decides which snapshots of each folder are kept. Set numbers here to use different ones on {name} than
        on other computers; empty settings use the <Link to="/repo?tab=defaults">repository defaults</Link>.
      </p>
      <Alert variant="warning" data-testid="file-retention-note">
        Disk images of {name} use these numbers too, except the ones a disk sets on its{" "}
        <Link to="/images?tab=retention">Disk Images › Retention</Link> tab.
      </Alert>
      <RetentionEditor
        source={source}
        ownLabel="This computer"
        selfName="this computer"
        savedText={"Saved. The next snapshot of each folder of " + name + " applies it."}
        testID="retention-computer"
      />
      <h5>Folders With Their Own Retention</h5>
      <FolderOverrides userName={userName} host={host} />
    </>
  );
}

FileRetention.propTypes = {
  userName: PropTypes.string.isRequired,
  host: PropTypes.string.isRequired,
};
