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
 * Returns the schedules that the settings the tasks were installed with
 * record: one for each set of disks imaged at the same time on the same
 * days. Settings written before there was one for each disk have one.
 */
export function installedScheduleGroups(schedule) {
  if (!schedule) {
    return [];
  }

  const groups = schedule.disks?.length
    ? schedule.disks
    : [{ volumes: schedule.volumes || [], at: schedule.at, days: schedule.days }];

  return groups
    .filter((g) => g.volumes?.length)
    .map((g) => ({ volumes: g.volumes, at: g.at || defaultScheduleSettings.at, days: g.days || [] }));
}

/**
 * Returns the form's settings from the settings the tasks were installed
 * with, or the defaults when they are not known. The first schedule is in
 * volumes, at and days, as KopiaUI has always taken them; disks holds the
 * others, when there are any.
 */
export function settingsFromSchedule(schedule) {
  if (!schedule) {
    return { ...defaultScheduleSettings };
  }

  const [first, ...others] = installedScheduleGroups(schedule);

  const settings = {
    volumes: first?.volumes || [],
    at: first?.at || defaultScheduleSettings.at,
    days: first?.days || [],
    checkDay: schedule.checkDay || "none",
    checkAt: schedule.checkAt || defaultScheduleSettings.checkAt,
    wake: schedule.wake ?? true,
    allowOnBattery: schedule.allowOnBattery ?? false,
  };

  if (others.length > 0) {
    settings.disks = others;
  }

  return settings;
}

/** Returns the schedules of the form's settings, the first one first. */
export function scheduleGroups(s) {
  return [{ volumes: s.volumes, at: s.at, days: s.days }, ...(s.disks || [])].filter((g) => g.volumes.length > 0);
}

function whenText(g) {
  return (g.days && g.days.length > 0 ? "on " + g.days.join(", ") : "every day") + " at " + g.at;
}

/**
 * Describes when images are created, e.g. "Images of the disks holding C:,
 * every day at 02:00."
 */
export function scheduleSummary(s) {
  const groups = scheduleGroups(s);
  let text = "Images of the disks holding " + groups.map((g) => g.volumes.join(" ") + ", " + whenText(g)).join("; of ");

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

  for (const g of s.disks || []) {
    args.push("--disk-schedule", g.volumes.join(",") + "=" + g.at + (g.days.length > 0 ? "/" + g.days.join(",") : ""));
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

/** Returns the schedule of each disk of the settings: one entry for each volume. */
export function perDiskSchedules(s) {
  return scheduleGroups(s).flatMap((g) => g.volumes.map((volume) => ({ volume, at: g.at, days: g.days })));
}

/**
 * Returns the settings with the schedules of the disks: disks imaged at the
 * same time on the same days share a schedule, which is run by one task.
 */
export function withDiskSchedules(s, perDisk) {
  const groups = [];

  for (const d of perDisk) {
    const days = weekdays.filter((x) => d.days.includes(x));
    const g = groups.find((x) => x.at === d.at && x.days.join() === days.join());

    if (g) {
      g.volumes.push(d.volume);
    } else {
      groups.push({ volumes: [d.volume], at: d.at, days });
    }
  }

  const [first, ...others] = groups;
  const { disks: _old, ...rest } = s;
  const out = { ...rest, volumes: first?.volumes || [], at: first?.at || s.at, days: first?.days || [] };

  if (others.length > 0) {
    out.disks = others;
  }

  return out;
}

/** Returns the schedule of the disk that holds one of the volumes, or undefined. */
export function diskScheduleOf(schedule, volumes) {
  return installedScheduleGroups(schedule).find((g) => g.volumes.some((v) => volumes.includes(v)));
}

/** Describes when a disk is imaged, e.g. "every day at 02:00". */
export function diskScheduleText(g) {
  return whenText(g);
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

/** The time and days of one disk's schedule; no days means every day. */
function WhenFields({ id, at, days, onChange }) {
  const everyDay = days.length === 0;

  const toggleDay = (day) => {
    const current = everyDay ? weekdays : days;
    const next = current.includes(day) ? current.filter((x) => x !== day) : [...current, day];

    if (next.length === 0) {
      return;
    }

    onChange({ at, days: next.length === weekdays.length ? [] : weekdays.filter((x) => next.includes(x)) });
  };

  return (
    <Row className="ms-4 mb-2 g-2 align-items-center" data-testid={"disk-when-" + id}>
      <Col xs="auto">
        <Form.Control
          type="time"
          size="sm"
          aria-label="Time"
          value={at}
          onChange={(e) => onChange({ at: e.target.value, days })}
        />
      </Col>
      <Col>
        {weekdays.map((day) => (
          <Form.Check
            inline
            key={day}
            type="checkbox"
            id={"image-day-" + id + "-" + day}
            label={day.substring(0, 3)}
            checked={everyDay || days.includes(day)}
            onChange={() => toggleDay(day)}
          />
        ))}
      </Col>
    </Row>
  );
}

WhenFields.propTypes = {
  id: PropTypes.string.isRequired,
  at: PropTypes.string.isRequired,
  days: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
};

/**
 * The disks to image, each with the time and days of its own schedule.
 * perDisk holds one entry for each disk chosen, named by one of its letters.
 */
function DiskSchedules({ disks, perDisk, defaultWhen, onChange }) {
  const { bytesStringBase2 } = use(UIPreferencesContext);

  if (disks === null) {
    return (
      <div>
        <Spinner size="sm" animation="border" /> Listing disks ...
      </div>
    );
  }

  const entryOf = (d) => perDisk.find((e) => d.volumes.some((v) => v.letter === e.volume));

  const toggle = (d) => {
    const e = entryOf(d);
    onChange(e ? perDisk.filter((x) => x !== e) : [...perDisk, { volume: d.volumes[0].letter, ...defaultWhen }]);
  };

  const change = (e, when) => onChange(perDisk.map((x) => (x === e ? { ...x, ...when } : x)));

  return (
    <>
      {disks.map((d) => {
        const e = entryOf(d);

        return (
          <div key={d.number}>
            <Form.Check
              type="checkbox"
              id={"image-disk-" + d.number}
              checked={!!e}
              onChange={() => toggle(d)}
              label={
                <>
                  {diskLabel(d, bytesStringBase2)} {d.system && <Badge bg="secondary">Windows</Badge>}
                </>
              }
            />
            {e && <WhenFields id={String(d.number)} at={e.at} days={e.days} onChange={(w) => change(e, w)} />}
          </div>
        );
      })}
      <Form.Text>
        Each disk is imaged whole, with all its partitions, at its own time. Disks at the same time are imaged one after
        the other; a disk whose time comes while another is imaged waits for it.
      </Form.Text>
    </>
  );
}

DiskSchedules.propTypes = {
  disks: PropTypes.array,
  perDisk: PropTypes.array.isRequired,
  defaultWhen: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

/**
 * Edits the image schedule: when each disk is imaged, and the weekly check.
 * KopiaUI saves it as administrator after the UAC prompt; in a browser the
 * form shows the command to run instead.
 */
export function ImageScheduleForm({ show, initial, onHide, onSaved }) {
  const { disks, error: disksError } = useLocalDisks();
  const [settings, setSettings] = useState(initial);
  // null until a disk is chosen: the Windows disk, at the default time
  const [perDisk, setPerDisk] = useState(() => {
    const p = perDiskSchedules(initial);
    return p.length > 0 ? p : null;
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const canSave = !!window.kopiaUI?.installImageSchedule;

  const defaultWhen = { at: initial.at || defaultScheduleSettings.at, days: initial.days || [] };
  const chosen = perDisk ?? systemVolumes(disks).map((volume) => ({ volume, ...defaultWhen }));
  const current = withDiskSchedules(settings, chosen);

  const set = (field, value) => setSettings((s) => ({ ...s, [field]: value }));

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

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Image Schedule</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {(error || disksError) && <Alert variant="danger">{error || disksError}</Alert>}
        <Form.Group className="mb-3">
          <Form.Label>Disks to image, and when</Form.Label>
          <DiskSchedules disks={disks} perDisk={chosen} defaultWhen={defaultWhen} onChange={setPerDisk} />
        </Form.Group>
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
 * Creates images now, whether or not images are scheduled: in KopiaUI, after
 * the UAC prompt, kopia image create runs in the background and the page shows
 * its progress; in a browser the dialog shows the command to run instead. The
 * disks of the schedule, if any, are chosen at first, else the Windows disk.
 *
 * onStart(volumes) returns a promise of the message to show: a success
 * closes the dialog, anything else stays in it.
 */
export function CreateImageDialog({ show, onHide, scheduledVolumes, onStart }) {
  const { disks, error: disksError } = useLocalDisks();
  const [chosenVolumes, setChosenVolumes] = useState(scheduledVolumes?.length ? scheduledVolumes : null);
  const [message, setMessage] = useState(null);
  const [starting, setStarting] = useState(false);

  const volumes = chosenVolumes ?? systemVolumes(disks);
  const canStart = !!window.kopiaUI?.createImageElevated;

  const start = () => {
    setStarting(true);
    setMessage(null);

    onStart(volumes)
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
          The image is created now, in the background: its progress shows on this page, where Stop ends it, as does
          signing out. A schedule, if any, is not affected.
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
