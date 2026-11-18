import axios from "axios";
import React, { useCallback, useEffect, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import { CLIEquivalent } from "./CLIEquivalent";
import { sourceQueryStringParams } from "../utils/policyutil";

/** The retention settings of a policy, in the order the policy editor shows them. */
export const retentionFields = [
  { key: "keepLatest", label: "Latest", flag: "--keep-latest", help: "The most recent images" },
  {
    key: "keepHourly",
    label: "Hourly",
    flag: "--keep-hourly",
    help: "The last image of each of the most recent hours",
  },
  { key: "keepDaily", label: "Daily", flag: "--keep-daily", help: "The last image of each of the most recent days" },
  {
    key: "keepWeekly",
    label: "Weekly",
    flag: "--keep-weekly",
    help: "The last image of each of the most recent weeks",
  },
  {
    key: "keepMonthly",
    label: "Monthly",
    flag: "--keep-monthly",
    help: "The last image of each of the most recent months",
  },
  {
    key: "keepAnnual",
    label: "Annual",
    flag: "--keep-annual",
    help: "The last image of each of the most recent years",
  },
];

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

/** Describes where an effective policy setting is defined, relative to the disk's source. */
export function definedBy(definition, source) {
  if (!definition) {
    return "";
  }

  if (definition.path) {
    return definition.path === source.path && definition.host === source.host && definition.userName === source.userName
      ? "this disk"
      : definition.path;
  }

  if (definition.host && definition.userName) {
    return definition.userName + "@" + definition.host;
  }

  if (definition.host) {
    return "@" + definition.host;
  }

  return "global policy";
}

/** Returns the kopia command that sets a disk's retention as the inputs do. */
export function retentionCommand(source, inputs) {
  const target = source.userName + "@" + source.host + ":" + source.path;
  const flags = retentionFields
    .filter((f) => (inputs[f.key] ?? "").trim() !== "")
    .map((f) => f.flag + " " + inputs[f.key].trim());

  return flags.length ? "policy set " + target + " " + flags.join(" ") : "policy show " + target;
}

function errorText(e) {
  return e?.response?.data?.error || e?.message || String(e);
}

/**
 * Edits the retention of one disk's images: the retention section of the
 * policy of its image source. The rest of that policy is kept as it is.
 */
export function DiskRetention({ source, title }) {
  const [policy, setPolicy] = useState(null);
  const [inputs, setInputs] = useState(() => inputsFromRetention());
  const [saved, setSaved] = useState(() => inputsFromRetention());
  const [resolved, setResolved] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

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
        setMessage({ variant: "success", text: "Saved. The next image run of this disk applies it." });
        load();
      })
      .catch((err) => setMessage({ variant: "danger", text: "Unable to save the retention: " + errorText(err) }))
      .finally(() => setSaving(false));
  };

  if (error) {
    return (
      <Alert variant="danger" data-testid="retention-error">
        {title}: unable to read its policy: {error}
      </Alert>
    );
  }

  if (!policy) {
    return <Spinner animation="border" size="sm" />;
  }

  return (
    <Form className="mb-4" onSubmit={save} data-testid={"retention-" + source.path}>
      <h6>{title}</h6>
      <Table size="sm" className="retention-table w-auto">
        <thead>
          <tr>
            <th>Keep</th>
            <th>This disk</th>
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
                  placeholder="inherit"
                  style={{ width: "7rem" }}
                  aria-label={f.label}
                  data-testid={"retention-input-" + f.key}
                  value={inputs[f.key]}
                  onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })}
                />
              </td>
              <td data-testid={"retention-effective-" + f.key}>
                {resolved?.effective?.retention?.[f.key] ?? "-"}
                <Form.Text className="ms-2">{definedBy(resolved?.definition?.retention?.[f.key], source)}</Form.Text>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {invalid && <Alert variant="warning">{invalid}</Alert>}
      {message && <Alert variant={message.variant}>{message.text}</Alert>}
      <Button type="submit" size="sm" variant="primary" disabled={!changed || !!invalid || saving}>
        {saving ? "Saving..." : "Save"}
      </Button>{" "}
      <Button
        size="sm"
        variant="secondary"
        disabled={saving || retentionFields.every((f) => (inputs[f.key] ?? "") === "")}
        onClick={() => setInputs(inputsFromRetention())}
      >
        Inherit All
      </Button>
      <CLIEquivalent command={retentionCommand(source, inputs)} />
    </Form>
  );
}

/** Lists the retention of every disk that has images. */
export function ImageRetention({ disks, titleOf }) {
  return (
    <>
      <p>
        Retention decides which images of a disk are kept. Every image run applies it when it ends, and the space of the
        images it deletes is freed when the repository&apos;s full maintenance runs. Empty settings inherit the global
        policy. Keep weekly and monthly images too, to be able to go back to before an infection that waited to strike.
      </p>
      {disks.length === 0 ? (
        <Alert variant="info">Retention can be set for a disk once it has an image.</Alert>
      ) : (
        disks.map((d) => <DiskRetention key={d.key} source={d.source} title={titleOf(d.source)} />)
      )}
    </>
  );
}
