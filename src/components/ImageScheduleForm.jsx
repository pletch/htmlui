import axios from "axios";
import PropTypes from "prop-types";
import React, { use, useEffect, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { UIPreferencesContext } from "../contexts/UIPreferencesContext";
import { sizeDisplayName } from "../utils/formatutils";

export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const defaultScheduleSettings = {
  volumes: [],
  at: "02:00",
  days: [],
  checkDay: "Sunday",
  checkAt: "12:00",
  wake: true,
  allowOnBattery: false,
};

/**
 * Returns the form's settings from the settings the tasks were installed
 * with, or the defaults when they are not known.
 */
export function settingsFromSchedule(schedule) {
  if (!schedule) {
    return { ...defaultScheduleSettings };
  }

  return {
    volumes: schedule.volumes || [],
    at: schedule.at || defaultScheduleSettings.at,
    days: schedule.days || [],
    checkDay: schedule.checkDay || "none",
    checkAt: schedule.checkAt || defaultScheduleSettings.checkAt,
    wake: schedule.wake ?? true,
    allowOnBattery: schedule.allowOnBattery ?? false,
  };
}

/**
 * Describes when images are created, e.g. "every day at 02:00".
 */
export function scheduleSummary(s) {
  const when = s.days && s.days.length > 0 ? "on " + s.days.join(", ") : "every day";
  let text = "Images of the disks holding " + s.volumes.join(" ") + ", " + when + " at " + s.at;

  if (s.checkDay && s.checkDay !== "none") {
    text += "; checked " + s.checkDay + "s at " + s.checkAt;
  }

  return text + ".";
}

/**
 * Returns the command that schedules images with these settings, for an
 * administrator command prompt.
 */
export function scheduleCommand(s) {
  const args = ["kopia", "image", "schedule", "install", ...s.volumes, "--at", s.at];

  if (s.days.length > 0) {
    args.push("--days", s.days.join(","));
  }

  args.push("--check-day", s.checkDay);

  if (s.checkDay !== "none") {
    args.push("--check-at", s.checkAt);
  }

  args.push(s.wake ? "--wake" : "--no-wake");

  if (s.allowOnBattery) {
    args.push("--allow-on-battery");
  }

  return args.join(" ");
}

function diskLabel(d, bytesStringBase2) {
  const volumes = d.volumes
    .map((v) => v.letter + (v.label ? " " + v.label : "") + " (" + sizeDisplayName(v.size, bytesStringBase2) + ")")
    .join(", ");

  return "Disk " + d.number + (d.model ? " - " + d.model : "") + ": " + volumes;
}

/**
 * Edits the image schedule. KopiaUI saves it as administrator after the UAC
 * prompt; in a browser the form shows the command to run instead.
 */
export function ImageScheduleForm({ show, initial, onHide, onSaved }) {
  const { bytesStringBase2 } = use(UIPreferencesContext);
  const [settings, setSettings] = useState(initial);
  const [disks, setDisks] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const canSave = !!window.kopiaUI?.installImageSchedule;
  const noVolumes = initial.volumes.length === 0;

  // the page mounts the form each time it opens, so this runs once per edit
  useEffect(() => {
    axios
      .get("/api/v1/images/disks")
      .then((result) => {
        const list = result.data.disks || [];
        setDisks(list);

        // the system disk unless the schedule says otherwise
        if (noVolumes) {
          const system = list.find((d) => d.system);
          if (system) {
            setSettings((s) => ({ ...s, volumes: [system.volumes[0].letter] }));
          }
        }
      })
      .catch((e) => setError("Unable to list the disks: " + (e.response?.data?.error || e.message)));
  }, [noVolumes]);

  const set = (field, value) => setSettings((s) => ({ ...s, [field]: value }));

  // a disk is chosen when one of its letters is in the volumes
  const diskChosen = (d) => d.volumes.some((v) => settings.volumes.includes(v.letter));

  const toggleDisk = (d) => {
    const letters = d.volumes.map((v) => v.letter);
    const others = settings.volumes.filter((v) => !letters.includes(v));
    set("volumes", diskChosen(d) ? others : [...others, letters[0]]);
  };

  // no days means every day
  const toggleDay = (day) => {
    const current = settings.days.length === 0 ? weekdays : settings.days;
    const next = current.includes(day) ? current.filter((x) => x !== day) : [...current, day];

    if (next.length === 0) {
      return;
    }

    set("days", next.length === weekdays.length ? [] : weekdays.filter((x) => next.includes(x)));
  };

  const save = () => {
    setSaving(true);
    setError(null);

    window.kopiaUI
      .installImageSchedule(settings)
      .then((status) => {
        if (status === "canceled") {
          setError("The administrator prompt was declined, so the schedule did not change.");
          return;
        }

        onSaved("Images are scheduled. " + scheduleSummary(settings));
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const everyDay = settings.days.length === 0;

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Image Schedule</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        <Form.Group className="mb-3">
          <Form.Label>Disks to image</Form.Label>
          {disks === null ? (
            <div>
              <Spinner size="sm" animation="border" /> Listing disks ...
            </div>
          ) : (
            disks.map((d) => (
              <Form.Check
                key={d.number}
                type="checkbox"
                id={"image-disk-" + d.number}
                checked={diskChosen(d)}
                onChange={() => toggleDisk(d)}
                label={
                  <>
                    {diskLabel(d, bytesStringBase2)} {d.system && <Badge bg="secondary">Windows</Badge>}
                  </>
                }
              />
            ))
          )}
          <Form.Text>Each disk is imaged whole, with all its partitions.</Form.Text>
        </Form.Group>
        <Row className="mb-3">
          <Form.Group as={Col} xs="auto" controlId="image-schedule-at">
            <Form.Label>Time</Form.Label>
            <Form.Control type="time" size="sm" value={settings.at} onChange={(e) => set("at", e.target.value)} />
          </Form.Group>
          <Form.Group as={Col}>
            <Form.Label>Days</Form.Label>
            <div>
              {weekdays.map((day) => (
                <Form.Check
                  inline
                  key={day}
                  type="checkbox"
                  id={"image-day-" + day}
                  label={day.substring(0, 3)}
                  checked={everyDay || settings.days.includes(day)}
                  onChange={() => toggleDay(day)}
                />
              ))}
            </div>
          </Form.Group>
        </Row>
        <Row className="mb-3">
          <Form.Group as={Col} xs="auto" controlId="image-schedule-check-day">
            <Form.Label>Weekly check</Form.Label>
            <Form.Select size="sm" value={settings.checkDay} onChange={(e) => set("checkDay", e.target.value)}>
              <option value="none">None</option>
              {weekdays.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          {settings.checkDay !== "none" && (
            <Form.Group as={Col} xs="auto" controlId="image-schedule-check-at">
              <Form.Label>at</Form.Label>
              <Form.Control
                type="time"
                size="sm"
                value={settings.checkAt}
                onChange={(e) => set("checkAt", e.target.value)}
              />
            </Form.Group>
          )}
        </Row>
        <Form.Check
          type="checkbox"
          id="image-schedule-wake"
          label="Wake the computer from sleep to create images"
          checked={settings.wake}
          onChange={(e) => set("wake", e.target.checked)}
        />
        <Form.Check
          type="checkbox"
          id="image-schedule-battery"
          label="Start on battery power"
          checked={settings.allowOnBattery}
          onChange={(e) => set("allowOnBattery", e.target.checked)}
        />
        {!canSave && (
          <Alert variant="info" className="mt-3">
            Run this in an administrator command prompt on this computer:
            <pre className="mb-0 mt-2" data-testid="schedule-command">
              {scheduleCommand(settings)}
            </pre>
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button size="sm" variant="secondary" onClick={onHide}>
          {canSave ? "Cancel" : "Close"}
        </Button>
        {canSave && (
          <Button
            size="sm"
            variant="primary"
            data-testid="save-schedule"
            disabled={saving || settings.volumes.length === 0}
            onClick={save}
            title="Asks for administrator rights"
          >
            {saving && <Spinner size="sm" animation="border" />} Save
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

ImageScheduleForm.propTypes = {
  show: PropTypes.bool.isRequired,
  initial: PropTypes.object.isRequired,
  onHide: PropTypes.func.isRequired,
  onSaved: PropTypes.func.isRequired,
};
