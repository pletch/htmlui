import axios from "axios";
import React, { useCallback, useEffect, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import PropTypes from "prop-types";
import { CLIEquivalent } from "./CLIEquivalent";
import { sourceQueryStringParams } from "../utils/policyutil";

/** The retention settings of a policy, in the order the policy editor shows them. */
export const retentionFields = [
  { key: "keepLatest", label: "Latest", flag: "--keep-latest", help: "The most recent snapshots" },
  {
    key: "keepHourly",
    label: "Hourly",
    flag: "--keep-hourly",
    help: "The last snapshot of each of the most recent hours",
  },
  {
    key: "keepDaily",
    label: "Daily",
    flag: "--keep-daily",
    help: "The last snapshot of each of the most recent days",
  },
  {
    key: "keepWeekly",
    label: "Weekly",
    flag: "--keep-weekly",
    help: "The last snapshot of each of the most recent weeks",
  },
  {
    key: "keepMonthly",
    label: "Monthly",
    flag: "--keep-monthly",
    help: "The last snapshot of each of the most recent months",
  },
  {
    key: "keepAnnual",
    label: "Annual",
    flag: "--keep-annual",
    help: "The last snapshot of each of the most recent years",
  },
];

/** The source of the global policy. */
export const globalSource = { userName: "", host: "", path: "" };

/** Tells whether a policy target is the global policy. */
export function isGlobalSource(source) {
  return !source.userName && !source.host && !source.path;
}

/** Returns the text inputs for the retention section of a policy: "" for an inherited setting. */
export function inputsFromRetention(retention) {
  return Object.fromEntries(
    retentionFields.map((f) => [f.key, retention?.[f.key] === undefined ? "" : String(retention[f.key])]),
  );
}

/**
 * Returns the retention section of a policy with the inputs applied: an empty
 * input inherits the setting, a number sets it. Other settings of previous
 * are kept. Throws on an input that is not a whole number.
 */
export function retentionFromInputs(inputs, previous) {
  const retention = { ...previous };

  for (const f of retentionFields) {
    const v = (inputs[f.key] ?? "").trim();

    if (v === "") {
      delete retention[f.key];
    } else if (/^\d+$/.test(v)) {
      retention[f.key] = parseInt(v, 10);
    } else {
      throw new Error(f.label + " must be a whole number, or empty to inherit it.");
    }
  }

  return retention;
}

/**
 * Describes where an effective policy setting is defined, relative to source:
 * selfName when it is defined by source itself.
 */
export function definedBy(definition, source, selfName = "this disk") {
  if (!definition) {
    return "";
  }

  const same =
    (definition.path || "") === (source.path || "") &&
    (definition.host || "") === (source.host || "") &&
    (definition.userName || "") === (source.userName || "");

  if (same) {
    return selfName;
  }

  if (definition.path) {
    return definition.path;
  }

  if (definition.host && definition.userName) {
    return definition.userName + "@" + definition.host;
  }

  if (definition.host) {
    return "@" + definition.host;
  }

  return "repository defaults";
}

/** Returns the kopia command that sets a source's retention as the inputs do. */
export function retentionCommand(source, inputs) {
  const target = isGlobalSource(source) ? "--global" : source.userName + "@" + source.host + ":" + source.path;
  const flags = retentionFields
    .filter((f) => (inputs[f.key] ?? "").trim() !== "")
    .map((f) => f.flag + " " + inputs[f.key].trim());

  return flags.length ? "policy set " + target + " " + flags.join(" ") : "policy show " + target;
}

function errorText(e) {
  return e?.response?.data?.error || e?.message || String(e);
}

/**
 * Edits the retention section of the policy of one source; the rest of the
 * policy is kept as it is. An empty input inherits the setting from the
 * wider policies, or for the global policy from kopia's built-in default.
 */
export function RetentionEditor({ source, title, ownLabel, selfName, savedText, testID }) {
  const [policy, setPolicy] = useState(null);
  const [inputs, setInputs] = useState(() => inputsFromRetention());
  const [saved, setSaved] = useState(() => inputsFromRetention());
  const [resolved, setResolved] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const isGlobal = isGlobalSource(source);
  const policyURL = "/api/v1/policy?" + sourceQueryStringParams(source);

  const load = useCallback(() => {
    axios
      .get(policyURL)
      .then((result) => result.data)
      .catch((e) => {
        if (e.response?.data?.code === "NOT_FOUND") {
          return {};
        }

        throw e;
      })
      .then((p) => {
        setPolicy(p);
        setInputs(inputsFromRetention(p.retention));
        setSaved(inputsFromRetention(p.retention));
      })
      .catch((e) => setError(errorText(e)));
  }, [policyURL]);

  useEffect(() => {
    load();
  }, [load]);

  let invalid = null;
  let retention = null;

  try {
    retention = retentionFromInputs(inputs, policy?.retention);
  } catch (e) {
    invalid = e.message;
  }

  // the effective settings with the inputs applied, and where each is defined
  const retentionKey = JSON.stringify(retention);

  useEffect(() => {
    if (!policy || invalid) {
      return;
    }

    axios
      .post("/api/v1/policy/resolve?" + sourceQueryStringParams(source), {
        updates: { ...policy, retention: JSON.parse(retentionKey) },
        numUpcomingSnapshotTimes: 0,
      })
      .then((result) => setResolved(result.data))
      .catch(() => setResolved(null));
  }, [policy, retentionKey, invalid, source]);

  const changed = retentionFields.some((f) => (inputs[f.key] ?? "").trim() !== (saved[f.key] ?? ""));

  // the global policy has nothing to inherit from: its empty settings take
  // kopia's built-in defaults, which the resolver reports as global too
  const origin = (f) =>
    isGlobal && (inputs[f.key] ?? "").trim() === ""
      ? "built-in default"
      : definedBy(resolved?.definition?.retention?.[f.key], source, selfName);

  const save = (e) => {
    e.preventDefault();

    if (invalid) {
      return;
    }

    setSaving(true);
    setMessage(null);

    axios
      .put(policyURL, { ...policy, retention })
      .then(() => {
        setMessage({ variant: "success", text: savedText });
        load();
      })
      .catch((err) => setMessage({ variant: "danger", text: "Unable to save the retention: " + errorText(err) }))
      .finally(() => setSaving(false));
  };

  if (error) {
    return (
      <Alert variant="danger" data-testid="retention-error">
        {title ? title + ": unable" : "Unable"} to read its policy: {error}
      </Alert>
    );
  }

  if (!policy) {
    return <Spinner animation="border" size="sm" />;
  }

  return (
    <Form className="mb-4" onSubmit={save} data-testid={testID}>
      {title && <h6>{title}</h6>}
      <Table size="sm" className="retention-table w-auto">
        <thead>
          <tr>
            <th>Keep</th>
            <th>{ownLabel}</th>
            <th>Effective</th>
          </tr>
        </thead>
        <tbody>
          {retentionFields.map((f) => (
            <tr key={f.key}>
              <td title={f.help}>{f.label}</td>
              <td>
                <Form.Control
                  size="sm"
                  inputMode="numeric"
                  placeholder={isGlobal ? "default" : "inherit"}
                  style={{ width: "7rem" }}
                  aria-label={f.label}
                  data-testid={"retention-input-" + f.key}
                  value={inputs[f.key]}
                  onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })}
                />
              </td>
              <td data-testid={"retention-effective-" + f.key}>
                {resolved?.effective?.retention?.[f.key] ?? "-"}
                <Form.Text className="ms-2">{origin(f)}</Form.Text>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {invalid && <Alert variant="warning">{invalid}</Alert>}
      {message && <Alert variant={message.variant}>{message.text}</Alert>}
      <Button type="submit" size="sm" variant="primary" disabled={!changed || !!invalid || saving}>
        {saving ? "Saving..." : "Save"}
      </Button>
      {!isGlobal && (
        <>
          {" "}
          <Button
            size="sm"
            variant="secondary"
            disabled={saving || retentionFields.every((f) => (inputs[f.key] ?? "") === "")}
            onClick={() => setInputs(inputsFromRetention())}
          >
            Inherit All
          </Button>
        </>
      )}
      <CLIEquivalent command={retentionCommand(source, inputs)} />
    </Form>
  );
}

RetentionEditor.propTypes = {
  source: PropTypes.object.isRequired,
  title: PropTypes.string,
  ownLabel: PropTypes.string.isRequired,
  selfName: PropTypes.string.isRequired,
  savedText: PropTypes.string.isRequired,
  testID: PropTypes.string,
};
