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
 * Lists the disks of the server's computer that can be imaged.
 *
 * @returns {{disks: Array|null, error: string|null}} disks is null while listing
 */
export function useLocalDisks() {
  const [disks, setDisks] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios
      .get("/api/v1/images/disks")
      .then((result) => setDisks(result.data.disks || []))
      .catch((e) => setError("Unable to list the disks: " + (e.response?.data?.error || e.message)));
  }, []);

  return { disks, error };
}

/**
 * Returns the volume that names the Windows disk, to image when nothing else
 * was chosen.
 */
export function systemVolumes(disks) {
  const system = (disks || []).find((d) => d.system);
  return system ? [system.volumes[0].letter] : [];
}

/**
 * Checkboxes for the disks to image; volumes holds one drive letter for each
 * disk chosen.
 */
export function DiskChecks({ disks, volumes, onChange }) {
  const { bytesStringBase2 } = use(UIPreferencesContext);

  if (disks === null) {
    return (
      <div>
        <Spinner size="sm" animation="border" /> Listing disks ...
      </div>
    );
  }

  // a disk is chosen when one of its letters is in the volumes
  const chosen = (d) => d.volumes.some((v) => volumes.includes(v.letter));

  const toggle = (d) => {
    const letters = d.volumes.map((v) => v.letter);
    const others = volumes.filter((v) => !letters.includes(v));
    onChange(chosen(d) ? others : [...others, letters[0]]);
  };

  return (
    <>
      {disks.map((d) => (
        <Form.Check
          key={d.number}
          type="checkbox"
          id={"image-disk-" + d.number}
          checked={chosen(d)}
          onChange={() => toggle(d)}
          label={
            <>
              {diskLabel(d, bytesStringBase2)} {d.system && <Badge bg="secondary">Windows</Badge>}
            </>
          }
        />
      ))}
      <Form.Text>Each disk is imaged whole, with all its partitions.</Form.Text>
    </>
  );
}

DiskChecks.propTypes = {
  disks: PropTypes.array,
  volumes: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
};

/**
 * Edits the image schedule. KopiaUI saves it as administrator after the UAC
 * prompt; in a browser the form shows the command to run instead.
 */
export function ImageScheduleForm({ show, initial, onHide, onSaved }) {
  const { disks, error: disksError } = useLocalDisks();
  const [settings, setSettings] = useState(initial);
  const [chosenVolumes, setChosenVolumes] = useState(initial.volumes.length > 0 ? initial.volumes : null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const canSave = !!window.kopiaUI?.installImageSchedule;

  // the Windows disk until a disk is chosen
  const current = { ...settings, volumes: chosenVolumes ?? systemVolumes(disks) };

  const set = (field, value) => setSettings((s) => ({ ...s, [field]: value }));

  // no days means every day
  const toggleDay = (day) => {
    const days = settings.days.length === 0 ? weekdays : settings.days;
    const next = days.includes(day) ? days.filter((x) => x !== day) : [...days, day];

    if (next.length === 0) {
      return;
    }

    set("days", next.length === weekdays.length ? [] : weekdays.filter((x) => next.includes(x)));
  };

  const save = () => {
    setSaving(true);
    setError(null);

    window.kopiaUI
      .installImageSchedule(current)
      .then((status) => {
        if (status === "canceled") {
          setError("The administrator prompt was declined, so the schedule did not change.");
          return;
        }

        onSaved("Images are scheduled. " + scheduleSummary(current));
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
        {(error || disksError) && <Alert variant="danger">{error || disksError}</Alert>}
        <Form.Group className="mb-3">
          <Form.Label>Disks to image</Form.Label>
          <DiskChecks disks={disks} volumes={current.volumes} onChange={setChosenVolumes} />
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
              {scheduleCommand(current)}
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
            disabled={saving || current.volumes.length === 0}
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

/**
 * Reports whether two volume lists name the same drive letters.
 */
export function sameVolumes(a, b) {
  return a.length === b.length && a.every((v) => b.includes(v));
}

/**
 * Creates images now. The disks of the schedule, if any, are chosen at
 * first: leaving them so runs the scheduled task, in the background as
 * SYSTEM. Other disks, or no schedule, run kopia image create in a console
 * window as administrator, after the UAC prompt; in a browser the dialog
 * shows the command to run instead.
 *
 * onStart(volumes, usesSchedule) returns a promise of the message to show:
 * a success closes the dialog, anything else stays in it.
 */
export function CreateImageDialog({ show, onHide, scheduledVolumes, onStart }) {
  const { disks, error: disksError } = useLocalDisks();
  const [chosenVolumes, setChosenVolumes] = useState(scheduledVolumes?.length ? scheduledVolumes : null);
  const [message, setMessage] = useState(null);
  const [starting, setStarting] = useState(false);

  const volumes = chosenVolumes ?? systemVolumes(disks);
  const usesSchedule = !!scheduledVolumes?.length && sameVolumes(volumes, scheduledVolumes);
  const canStart = usesSchedule || !!window.kopiaUI?.createImageElevated;

  const start = () => {
    setStarting(true);
    setMessage(null);

    onStart(volumes, usesSchedule)
      .then((m) => {
        if (m.variant !== "success") {
          setMessage(m);
        }
      })
      .catch((e) => setMessage({ variant: "danger", text: e.response?.data?.error || e.message }))
      .finally(() => setStarting(false));
  };

  return (
    <Modal show={show} onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>Create Image Now</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {disksError && <Alert variant="danger">{disksError}</Alert>}
        {message && <Alert variant={message.variant}>{message.text}</Alert>}
        <Form.Group className="mb-3">
          <Form.Label>Disks to image</Form.Label>
          <DiskChecks disks={disks} volumes={volumes} onChange={setChosenVolumes} />
        </Form.Group>
        <p className="text-muted small mb-0" data-testid="create-image-how">
          {usesSchedule
            ? "These are the scheduled disks: the scheduled task images them in the background, and goes on when you sign out."
            : "The image is created in a console window, which shows its progress, while you are signed in."}
        </p>
        {!canStart && (
          <Alert variant="info" className="mt-3">
            Run this in an administrator command prompt on this computer:
            <pre className="mb-0 mt-2" data-testid="create-image-command">
              kopia image create {volumes.join(" ")}
            </pre>
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button size="sm" variant="secondary" onClick={onHide}>
          {canStart ? "Cancel" : "Close"}
        </Button>
        {canStart && (
          <Button
            size="sm"
            variant="primary"
            data-testid="start-image"
            disabled={starting || volumes.length === 0}
            onClick={start}
            title="May ask for administrator rights"
          >
            {starting && <Spinner size="sm" animation="border" />} Create Image
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

CreateImageDialog.propTypes = {
  show: PropTypes.bool.isRequired,
  onHide: PropTypes.func.isRequired,
  scheduledVolumes: PropTypes.array,
  onStart: PropTypes.func.isRequired,
};
