import axios from "axios";
import React, { useEffect, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import { Link } from "react-router";
import { RetentionEditor, globalSource, retentionFields } from "./RetentionEditor";
import { compare } from "../utils/formatutils";
import { policyEditorURL } from "../utils/policyutil";

/** Names the computer or user a host-wide or user-wide policy applies to. */
export function computerName(target) {
  return target.userName ? target.userName + "@" + target.host : "All users on " + target.host;
}

/** Summarizes the retention a policy sets, or "" when it sets none. */
export function retentionSummary(policy) {
  return retentionFields
    .filter((f) => policy?.retention?.[f.key] !== undefined)
    .map((f) => f.label + ": " + policy.retention[f.key])
    .join(", ");
}

/** Returns the policies of whole computers and users (not of a folder or disk), sorted. */
export function computerPolicies(policies) {
  return policies
    .filter((p) => p.target.host && !p.target.path)
    .sort((l, r) => compare(l.target.host, r.target.host) || compare(l.target.userName || "", r.target.userName || ""));
}

function errorText(e) {
  return e?.response?.data?.error || e?.message || String(e);
}

/** Lists the computers and users whose own policy overrides the repository defaults. */
function ComputerOverrides() {
  const [policies, setPolicies] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios
      .get("/api/v1/policies")
      .then((result) => setPolicies(computerPolicies(result.data.policies || [])))
      .catch((e) => setError(errorText(e)));
  }, []);

  if (error) {
    return <Alert variant="danger">Unable to list the policies: {error}</Alert>;
  }

  if (!policies) {
    return <Spinner animation="border" size="sm" />;
  }

  if (policies.length === 0) {
    return <p className="text-muted">No computer has its own settings: all of them use the repository defaults.</p>;
  }

  return (
    <Table size="sm" responsive className="w-auto" data-testid="computer-overrides">
      <thead>
        <tr>
          <th>Computer</th>
          <th>Retention</th>
          <th>
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {policies.map((p) => (
          <tr key={p.id || computerName(p.target)}>
            <td>{computerName(p.target)}</td>
            <td>{retentionSummary(p.policy) || <span className="text-muted">defaults</span>}</td>
            <td>
              <Link to={policyEditorURL(p.target)}>Edit</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * The repository-wide defaults: the settings of the global policy that both
 * file snapshots and disk images use. Only retention is shared; disk images
 * ignore the global compression and the other file settings.
 */
export function RepositoryDefaults() {
  return (
    <>
      <p>
        These defaults apply to the file snapshots and disk images of every computer that uses this repository. A
        computer, a folder or a disk can override them; empty settings take kopia&apos;s built-in defaults.
      </p>
      <h5>Retention</h5>
      <p className="text-muted">
        How many snapshots of each folder or disk to keep. Older ones are deleted when the next snapshot or image ends.
      </p>
      <RetentionEditor
        source={globalSource}
        ownLabel="Default"
        selfName="set here"
        savedText="Saved. Every computer's next snapshot or image applies it."
        testID="retention-global"
      />
      <h5>Computers With Their Own Settings</h5>
      <p className="text-muted">
        These apply to both the file snapshots and the disk images of that computer, before the defaults above.
      </p>
      <ComputerOverrides />
    </>
  );
}
