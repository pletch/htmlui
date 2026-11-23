import axios from "axios";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import PropTypes from "prop-types";
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

function computerKey(t) {
  return (t.userName || "") + "@" + t.host;
}

/**
 * Returns every computer the repository knows, sorted: this one, the ones
 * with snapshots or images, and the ones with a policy of their own. Each
 * has the target of its policy and that policy, if it has one.
 */
export function knownComputers(policies, sources, local) {
  const byKey = new Map();
  const add = (userName, host, policy) => {
    if (!host) {
      return;
    }

    const target = { userName: userName || "", host, path: "" };
    const key = computerKey(target);
    const c = byKey.get(key) || { key, target, policy: null, local: false };

    c.policy = policy || c.policy;
    byKey.set(key, c);

    return c;
  };

  const me = add(local?.userName, local?.host);
  if (me) {
    me.local = true;
  }

  for (const s of sources) {
    add(s.source.userName, s.source.host);
  }

  for (const p of computerPolicies(policies)) {
    add(p.target.userName, p.target.host, p.policy);
  }

  return [...byKey.values()].sort(
    (l, r) => compare(l.target.host, r.target.host) || compare(l.target.userName, r.target.userName),
  );
}

function errorText(e) {
  return e?.response?.data?.error || e?.message || String(e);
}

/**
 * Lists the computers the repository knows, see knownComputers.
 *
 * @returns {{list: Array, local: object|undefined}|null} null while listing
 */
export function useKnownComputers() {
  const [computers, setComputers] = useState(null);

  useEffect(() => {
    let live = true;

    Promise.all([
      axios
        .get("/api/v1/policies")
        .then((r) => r.data.policies || [])
        .catch(() => []),
      axios
        .get("/api/v1/sources")
        .then((r) => r.data)
        .catch(() => ({ sources: [] })),
    ]).then(([policies, src]) => {
      if (!live) {
        return;
      }

      const list = knownComputers(policies, src.sources || [], { userName: src.localUsername, host: src.localHost });
      setComputers({ list, local: list.find((c) => c.local) });
    });

    return () => {
      live = false;
    };
  }, []);

  return computers;
}

/** One computer: its retention, and its editor while it is open. */
function ComputerRow({ computer, open, onToggle, onSaved }) {
  const name = computerName(computer.target);

  return (
    <>
      <tr data-testid={"computer-" + computer.key}>
        <td>
          {name}
          {computer.local && <span className="text-muted small"> (this computer)</span>}
        </td>
        <td>{retentionSummary(computer.policy) || <span className="text-muted">repository defaults</span>}</td>
        <td className="text-nowrap">
          <Button size="sm" variant="secondary" onClick={onToggle} data-testid="computer-edit">
            {open ? "Close" : "Edit Retention"}
          </Button>{" "}
          <Link to={policyEditorURL(computer.target)} title={"Every setting of " + name}>
            All Settings
          </Link>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={3}>
            <RetentionEditor
              source={computer.target}
              ownLabel={name}
              selfName={name}
              savedText={
                "Saved. The next snapshot of each folder and the next image of each disk of " + name + " apply it."
              }
              testID={"retention-" + computer.key}
              onSaved={onSaved}
            />
          </td>
        </tr>
      )}
    </>
  );
}

ComputerRow.propTypes = {
  computer: PropTypes.object.isRequired,
  open: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  onSaved: PropTypes.func.isRequired,
};

/** Lists the computers, each with the retention it sets for its folders and disks. */
function Computers() {
  const [policies, setPolicies] = useState(null);
  const [sources, setSources] = useState({ sources: [] });
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  const loadPolicies = useCallback(() => {
    axios
      .get("/api/v1/policies")
      .then((result) => setPolicies(result.data.policies || []))
      .catch((e) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    loadPolicies();

    // the computers with snapshots, and this one; without them only the
    // computers with a policy are listed
    axios
      .get("/api/v1/sources")
      .then((result) => setSources(result.data))
      .catch(() => {});
  }, [loadPolicies]);

  const computers = useMemo(
    () =>
      policies
        ? knownComputers(policies, sources.sources || [], { userName: sources.localUsername, host: sources.localHost })
        : null,
    [policies, sources],
  );

  if (error) {
    return <Alert variant="danger">Unable to list the policies: {error}</Alert>;
  }

  if (!computers) {
    return <Spinner animation="border" size="sm" />;
  }

  if (computers.length === 0) {
    return <p className="text-muted">No computer has snapshots or settings of its own yet.</p>;
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
        {computers.map((c) => (
          <ComputerRow
            key={c.key}
            computer={c}
            open={open === c.key}
            onToggle={() => setOpen(open === c.key ? null : c.key)}
            onSaved={loadPolicies}
          />
        ))}
      </tbody>
    </Table>
  );
}

/**
 * The repository-wide defaults: the settings of the global policy that both
 * file snapshots and disk images use, and each computer's own. Only
 * retention is shared; disk images ignore the other file settings.
 */
export function RepositoryDefaults() {
  return (
    <>
      <p>
        Retention decides how many snapshots of each folder and images of each disk are kept. It is set here for every
        computer that uses this repository, and for a computer of its own. A folder&apos;s Policy tab or a disk&apos;s
        Settings can override both.
      </p>
      <h5>Default Retention</h5>
      <p className="text-muted">
        For every folder and disk without settings of its own. Older snapshots and images are deleted when the next one
        ends; empty settings take kopia&apos;s built-in defaults.
      </p>
      <RetentionEditor
        source={globalSource}
        ownLabel="Default"
        selfName="set here"
        savedText="Saved. Every computer's next snapshot or image applies it."
        testID="retention-global"
      />
      <h5>Computers</h5>
      <p className="text-muted">
        A computer&apos;s own retention applies to both its folders and its disks, before the defaults above.
      </p>
      <Computers />
      <p className="text-muted">
        Every policy, including the ones of single folders and disks, is listed on the{" "}
        <Link to="/policies">All Policies</Link> page.
      </p>
    </>
  );
}
