import { faExclamationTriangle, faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import axios from "axios";
import moment from "moment";
import React, { use, useCallback, useEffect, useRef, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import ProgressBar from "react-bootstrap/ProgressBar";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import { Link } from "react-router";
import {
  CreateImageDialog,
  ImageScheduleForm,
  scheduleSummary,
  settingsFromSchedule,
} from "../components/ImageScheduleForm";
import KopiaTable from "../components/KopiaTable";
import { UIPreferencesContext } from "../contexts/UIPreferencesContext";
import { formatDuration, objectLink, sizeDisplayName } from "../utils/formatutils";
import { redirect } from "../utils/uiutil";

const statusRefreshMillis = 5000;

const diskSourcePrefix = "image:disk:";

// Task Scheduler result codes that are not failures, as schtasks prints them.
const taskResults = {
  0: "Succeeded",
  267009: "Running",
  267011: "Has not run yet",
  267014: "Stopped",
};

export function taskResultDisplayName(r) {
  if (r === undefined || r === "") {
    return "";
  }

  const known = taskResults[r];
  if (known) {
    return known;
  }

  const n = Number(r);
  if (Number.isInteger(n)) {
    return "Failed (0x" + (n >>> 0).toString(16) + ")";
  }

  return r;
}

export function diskDisplayName(source) {
  if (source.path.startsWith(diskSourcePrefix)) {
    return "Disk " + source.path.substring(diskSourcePrefix.length);
  }

  return source.path;
}

function errorText(e) {
  return e.response?.data?.error || e.message || String(e);
}

/**
 * Returns the Badge colour for a Task Scheduler last result: green for
 * success, red for a failure code, grey for results that are not failures.
 */
export function taskResultVariant(r) {
  if (r === undefined || r === "") {
    return null;
  }
  if (String(r) === "0") {
    return "success";
  }
  if (String(r) === "267009") {
    return "primary";
  }
  if (taskResults[r]) {
    return "secondary";
  }
  return "danger";
}

/** Returns the Badge colour for a Task Scheduler status such as Ready or Running. */
export function taskStateVariant(status) {
  switch (status) {
    case "Running":
      return "primary";
    case "Disabled":
      return "warning";
    default:
      return "secondary";
  }
}

/** Shows a scheduled task as its short name with the full Task Scheduler path under it. */
function TaskNameCell({ name }) {
  const short = name.substring(name.lastIndexOf("\\") + 1);
  return (
    <td className="col-source">
      <span className="source-name">{short}</span>
      <span className="source-path">{name}</span>
    </td>
  );
}

function TaskRow({ task }) {
  if (task.error) {
    return (
      <tr>
        <TaskNameCell name={task.name} />
        <td colSpan={4}>
          <Badge bg="danger">error</Badge> <span className="text-danger">{task.error}</span>
        </td>
      </tr>
    );
  }

  if (!task.scheduled) {
    return (
      <tr>
        <TaskNameCell name={task.name} />
        <td colSpan={4}>
          <Badge bg="secondary">not scheduled</Badge>
        </td>
      </tr>
    );
  }

  if (task.statusHidden) {
    return (
      <tr>
        <TaskNameCell name={task.name} />
        <td colSpan={4} data-testid="task-status-hidden">
          <Badge bg="secondary">scheduled</Badge>{" "}
          <span className="text-muted">
            Task Scheduler shows the status of tasks that run as SYSTEM only to administrators.
          </span>
        </td>
      </tr>
    );
  }

  const result = taskResultDisplayName(task.lastResult);
  const resultVariant = taskResultVariant(task.lastResult);
  return (
    <tr>
      <TaskNameCell name={task.name} />
      <td className="col-time">{task.status && <Badge bg={taskStateVariant(task.status)}>{task.status}</Badge>}</td>
      <td className="col-time">{task.nextRunTime}</td>
      <td className="col-time">
        {/* Task Scheduler reports a placeholder date (11/30/1999) for tasks that have not run. */}
        {String(task.lastResult) === "267011" ? <span className="text-muted">never</span> : task.lastRunTime}
      </td>
      <td className="col-time">{resultVariant ? <Badge bg={resultVariant}>{result}</Badge> : result}</td>
    </tr>
  );
}

function LastRun({ status, bytesStringBase2 }) {
  if (status.lastRunError) {
    return <Alert variant="danger">Unable to read the last image run: {status.lastRunError}</Alert>;
  }

  const run = status.lastRun;
  if (!run) {
    return <p>No image run has completed yet.</p>;
  }

  return (
    <>
      <p>
        {run.success && <Badge bg="success">Succeeded</Badge>}
        {run.stopped && (
          <Badge bg="secondary" data-testid="last-run-stopped">
            Stopped
          </Badge>
        )}
        {!run.success && !run.stopped && (
          <Badge bg="danger" data-testid="last-run-failed">
            Failed
          </Badge>
        )}{" "}
        Imaged {(run.volumes || []).join(" ")}{" "}
        <span title={moment(run.startTime).toLocaleString()}>{moment(run.startTime).fromNow()}</span>, took{" "}
        {formatDuration(run.startTime, run.endTime, true)}.
        {run.stopped && " It was stopped; what it uploaded is reused by the next image."}
      </p>
      {run.error && !run.stopped && <Alert variant="danger">{run.error}</Alert>}
      {(run.images || []).length > 0 && (
        <ul>
          {run.images.map((img) => (
            <li key={img.snapshotId}>
              {img.source}: read {sizeDisplayName(img.bytesRead, bytesStringBase2)}, new data{" "}
              {img.newDataBytes === undefined ? "?" : sizeDisplayName(img.newDataBytes, bytesStringBase2)}, stored{" "}
              {img.uploadedBytes === undefined ? "?" : sizeDisplayName(img.uploadedBytes, bytesStringBase2)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The recovery media heading, with the button that builds new media: in
 * KopiaUI it opens a console window as administrator, in a browser it tells
 * the command to run.
 */
function RecoveryMediaHeading({ busy, onCreate }) {
  const canCreate = !!window.kopiaUI?.createRecoveryMediaElevated;

  return (
    <Row className="mb-2 align-items-center">
      <Col>
        <h6 className="mb-0">Recovery media</h6>
      </Col>
      <Col xs="auto">
        {canCreate ? (
          <Button
            size="sm"
            variant="secondary"
            data-testid="create-recovery-media"
            disabled={busy}
            onClick={onCreate}
            title="Make a USB stick that restores this computer's disk images; asks for administrator rights"
          >
            Create Recovery Media...
          </Button>
        ) : (
          <span className="text-muted small">
            Build it with <code>kopia image recovery-media create</code> in an administrator command prompt.
          </span>
        )}
      </Col>
    </Row>
  );
}

function RecoveryMedia({ status, busy, onCreate }) {
  const findings = status.lastRun?.recoveryMedia || [];
  const media = status.recoveryMedia;
  const heading = <RecoveryMediaHeading busy={busy} onCreate={onCreate} />;

  if (status.recoveryMediaError) {
    return (
      <>
        {heading}
        <Alert variant="danger">Unable to read the recovery media record: {status.recoveryMediaError}</Alert>
      </>
    );
  }

  if (!media) {
    return (
      <>
        {heading}
        <Alert variant="warning">
          <FontAwesomeIcon icon={faExclamationTriangle} /> No recovery media was built on this computer. Without it, the
          system disk can only be restored from a Linux live system. Media built on another computer can restore this
          one too: register it with <code>kopia image recovery-media register E:\</code> in an administrator command
          prompt.
        </Alert>
      </>
    );
  }

  const builtAt = <span title={moment(media.builtAt).toLocaleString()}>{moment(media.builtAt).fromNow()}</span>;

  return (
    <>
      {heading}
      {media.builtOn ? (
        <p data-testid="recovery-media-shared">
          Built on {media.builtOn} {builtAt} with kopia {media.kopiaVersion}, registered from {media.target}.{" "}
          {media.drivers
            ? "It has " + media.drivers.length + " storage, network and USB drivers, added on " + media.builtOn
            : "It has the drivers of " + media.builtOn}
          : check that it starts this computer.
          {media.passwordEmbedded && " It holds the repository password: keep it safe."}
        </p>
      ) : (
        <p>
          Built {builtAt} with kopia {media.kopiaVersion}, written to {media.target}.
          {media.passwordEmbedded && " It holds the repository password: keep it safe."}
        </p>
      )}
      {findings.length > 0 && (
        <Alert variant="warning" data-testid="recovery-media-findings">
          <FontAwesomeIcon icon={faExclamationTriangle} /> The recovery media no longer matches this computer;{" "}
          {media.builtOn ? "build new media, here or on " + media.builtOn + " and register it" : "build new media"}.
          <ul className="mb-0 mt-2">
            {findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}

/**
 * Shows the schedule settings and what needs attention: tasks that write to
 * another repository, or that run an older kopia.
 */
function ScheduleSettings({ status, busy, onUpdate }) {
  const s = status.schedule;
  if (!s) {
    return null;
  }

  const canUpdate = !!window.kopiaUI?.installImageSchedule;

  return (
    <>
      <p data-testid="schedule-summary">
        {s.paused && (
          <>
            <Badge bg="secondary" data-testid="schedule-paused">
              Paused
            </Badge>{" "}
          </>
        )}
        {scheduleSummary(s)}
        {s.paused && " Images are not created automatically until the schedule is resumed."}
      </p>
      {status.scheduleForThisRepository === false && (
        <Alert variant="warning" data-testid="schedule-other-repository">
          <FontAwesomeIcon icon={faExclamationTriangle} /> The scheduled images go to another repository
          {s.repository ? ", " + s.repository : ""}. Changing the schedule here makes them go to this one.
        </Alert>
      )}
      {s.kopiaVersion && status.kopiaVersion && s.kopiaVersion !== status.kopiaVersion && (
        <Alert variant="warning" data-testid="schedule-outdated">
          <FontAwesomeIcon icon={faExclamationTriangle} /> The scheduled tasks run kopia {s.kopiaVersion}; this is kopia{" "}
          {status.kopiaVersion}.{" "}
          {canUpdate ? (
            <Button size="sm" variant="warning" disabled={busy} onClick={onUpdate} data-testid="update-schedule">
              Update the Tasks
            </Button>
          ) : (
            <>
              Run <code>kopia image schedule install</code> again in an administrator command prompt.
            </>
          )}
        </Alert>
      )}
    </>
  );
}

/**
 * Returns how far an image run got, from 0 to 1, over all its disks: each
 * disk counts equally, and within a disk the bytes of its volumes.
 */
export function progressFraction(p) {
  const disks = Math.max(p.disks || 1, 1);
  const disk = Math.min(Math.max(p.disk || 1, 1), disks);
  const within = p.bytesTotal > 0 ? Math.min(p.bytesDone / p.bytesTotal, 1) : 0;

  return (disk - 1 + within) / disks;
}

/**
 * Shows the image run in progress, with the button that stops it.
 */
function RunProgress({ progress, bytesStringBase2, busy, onStop }) {
  const fraction = progressFraction(progress);
  const percent = Math.floor(fraction * 100);
  // measured when the counts were written, not when the page renders
  const elapsedMillis = new Date(progress.updatedAt).valueOf() - new Date(progress.startTime).valueOf();
  const remaining =
    fraction > 0.02 && elapsedMillis > 0
      ? moment.duration((elapsedMillis * (1 - fraction)) / fraction).humanize()
      : null;
  const canStop = !!window.kopiaUI?.stopImageElevated;

  return (
    <Alert variant="info" data-testid="image-progress">
      <Row className="align-items-center mb-2">
        <Col>
          <strong>Creating an image</strong> of the disks holding {(progress.volumes || []).join(" ")}
          {progress.disks > 1 && ", disk " + progress.disk + " of " + progress.disks}
          {progress.partition > 0 && (
            <>
              : partition {progress.partition} of {progress.partitions}
              {progress.partitionName ? " (" + progress.partitionName + ")" : ""}
            </>
          )}
        </Col>
        <Col xs="auto">
          {canStop ? (
            <Button
              size="sm"
              variant="danger"
              data-testid="stop-image"
              disabled={busy || progress.stopping}
              onClick={onStop}
              title="Asks for administrator rights; what was uploaded is kept"
            >
              {progress.stopping ? "Stopping..." : "Stop"}
            </Button>
          ) : (
            <span className="small">
              Stop it with <code>kopia image stop</code> in an administrator command prompt.
            </span>
          )}
        </Col>
      </Row>
      <ProgressBar now={percent} label={percent + "%"} animated={!progress.stopping} data-testid="image-progress-bar" />
      <div className="small mt-2" data-testid="image-progress-details">
        {sizeDisplayName(progress.bytesDone, bytesStringBase2)} of{" "}
        {sizeDisplayName(progress.bytesTotal, bytesStringBase2)} of this disk done,{" "}
        {sizeDisplayName(progress.uploadedBytes || 0, bytesStringBase2)} uploaded; started{" "}
        {moment(progress.startTime).fromNow()}
        {remaining && !progress.stopping && ", about " + remaining + " left"}.
      </div>
    </Alert>
  );
}

/**
 * Tells when an image started from this page did not start, which happens
 * before it writes any progress: there is no window to show it.
 */
function FailedStart({ status }) {
  const req = status.lastRequest;
  if (!req || req.success || req.operation !== "create") {
    return null;
  }

  // a later run replaced it
  if (status.lastRun && new Date(status.lastRun.startTime) > new Date(req.time)) {
    return null;
  }

  return (
    <Alert variant="danger" data-testid="image-failed-start">
      The image started <span title={moment(req.time).toLocaleString()}>{moment(req.time).fromNow()}</span> did not run:{" "}
      {req.error}
    </Alert>
  );
}

function ImageStatus({
  status,
  bytesStringBase2,
  onRun,
  onEdit,
  onRemove,
  onPause,
  onUpdate,
  onCreateRecoveryMedia,
  onStop,
  busy,
  message,
}) {
  if (!status.supported) {
    return (
      <Alert variant="info">
        <FontAwesomeIcon icon={faInfoCircle} /> Disk images are created on Windows. Images of this repository&apos;s
        Windows computers are listed below.
      </Alert>
    );
  }

  const createTask = status.tasks[0];
  const taskRunning = createTask?.status === "Running";
  const scheduled = createTask?.scheduled;

  return (
    <Card className="mb-3">
      <Card.Body>
        <Row className="mb-2">
          <Col>
            <h5>Disk images of this computer</h5>
          </Col>
          <Col xs="auto">
            <Button
              size="sm"
              variant="primary"
              data-testid="run-image-task"
              disabled={taskRunning || busy || !!status.progress}
              onClick={onRun}
              title="Create images of this computer's disks now, with or without a schedule; asks for administrator rights"
            >
              {busy || taskRunning ? <Spinner size="sm" animation="border" /> : null} Create Image Now
            </Button>
            <Button size="sm" variant="secondary" data-testid="edit-schedule" disabled={busy} onClick={onEdit}>
              {scheduled ? "Change Schedule..." : "Set Up Schedule..."}
            </Button>
            {scheduled && window.kopiaUI?.pauseImageSchedule && (
              <Button
                size="sm"
                variant="secondary"
                data-testid="pause-schedule"
                disabled={busy}
                onClick={() => onPause(!!status.schedule?.paused)}
                title="Asks for administrator rights; an image being created goes on"
              >
                {status.schedule?.paused ? "Resume Schedule" : "Pause Schedule"}
              </Button>
            )}
            {scheduled && window.kopiaUI?.removeImageSchedule && (
              <Button size="sm" variant="secondary" data-testid="remove-schedule" disabled={busy} onClick={onRemove}>
                Remove Schedule
              </Button>
            )}
          </Col>
        </Row>
        {message && <Alert variant={message.variant}>{message.text}</Alert>}
        <FailedStart status={status} />
        {status.progress && (
          <RunProgress progress={status.progress} bytesStringBase2={bytesStringBase2} busy={busy} onStop={onStop} />
        )}
        {!scheduled && !createTask?.error && (
          <Alert variant="info">
            <FontAwesomeIcon icon={faInfoCircle} /> Images are not scheduled on this computer. Create one now, or set up
            a schedule to create them automatically.
          </Alert>
        )}
        {scheduled && <ScheduleSettings status={status} busy={busy} onUpdate={onUpdate} />}
        {status.scheduleError && <Alert variant="danger">{status.scheduleError}</Alert>}
        <Table size="sm" responsive>
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Next Run</th>
              <th>Last Run</th>
              <th>Last Result</th>
            </tr>
          </thead>
          <tbody>
            {status.tasks.map((t) => (
              <TaskRow key={t.name} task={t} />
            ))}
          </tbody>
        </Table>
        <h6>Last image run</h6>
        <LastRun status={status} bytesStringBase2={bytesStringBase2} />
        <RecoveryMedia status={status} busy={busy} onCreate={onCreateRecoveryMedia} />
      </Card.Body>
    </Card>
  );
}

/**
 * Shows an image as its disk name, linking to the image's files, with its
 * volumes and, when images of several computers are listed, the computer under it.
 */
function imageCell(image, diskName, showHost) {
  const volumes = (image.volumes || []).map((v) => v.entryName).join(", ");
  return (
    <>
      <Link className="source-link" to={objectLink(image.rootID)} title={image.source.host + ": " + diskName}>
        <span className="source-name">{diskName}</span>
        {volumes && <span className="source-path">{volumes}</span>}
        {showHost && <span className="source-owner">{image.source.host}</span>}
      </Link>
      {image.metadataError && (
        <FontAwesomeIcon
          color="red"
          icon={faExclamationTriangle}
          title={"Unable to read the image statistics: " + image.metadataError}
        />
      )}
    </>
  );
}

function imageColumns(bytesStringBase2, showHost) {
  const size = (v) => (v === undefined ? "" : sizeDisplayName(v, bytesStringBase2));

  const num = { className: "col-num" };

  return [
    {
      id: "startTime",
      header: "Started",
      meta: { className: "col-time" },
      accessorFn: (x) => x.startTime,
      cell: (x) => (
        <>
          <span className="time-last" title={moment(x.getValue()).toLocaleString()}>
            {moment(x.getValue()).fromNow()}
          </span>
          {x.row.original.endTime && (
            <span className="time-next">
              took {formatDuration(x.row.original.startTime, x.row.original.endTime, true)}
            </span>
          )}
        </>
      ),
    },
    {
      id: "disk",
      header: "Image",
      meta: { className: "col-source" },
      accessorFn: (x) => diskDisplayName(x.source),
      cell: (x) => imageCell(x.row.original, x.getValue(), showHost),
    },
    { id: "size", header: "Disk Size", meta: num, accessorFn: (x) => x.size, cell: (x) => size(x.getValue()) },
    { id: "read", header: "Read", meta: num, accessorFn: (x) => x.bytesRead, cell: (x) => size(x.getValue()) },
    {
      id: "newData",
      header: "New Data",
      meta: num,
      accessorFn: (x) => x.newDataBytes,
      cell: (x) => size(x.getValue()),
    },
    {
      id: "uploaded",
      header: "Stored",
      meta: num,
      accessorFn: (x) => x.uploadedBytes,
      cell: (x) => size(x.getValue()),
    },
  ];
}

/** Tells whether recovery media holds a version of a driver, by its INF name. */
export function mediaHasDriver(mediaDrivers, driver) {
  const inf = driver.inf.toLowerCase();
  return mediaDrivers.some((d) => d.inf.toLowerCase() === inf);
}

/**
 * Lists the storage, network and USB drivers that the images of each
 * computer store, which recovery media needs to restore it, and whether this
 * computer's recovery media has them. It shows nothing until an image stores
 * drivers, nor when the server cannot list them.
 */
function DriverInventory({ mediaDrivers }) {
  const [hosts, setHosts] = useState(null);

  useEffect(() => {
    axios
      .get("/api/v1/images/drivers")
      .then((result) => setHosts(result.data.hosts || []))
      .catch(() => setHosts([]));
  }, []);

  if (!hosts || hosts.length === 0) {
    return null;
  }

  const rows = hosts.flatMap((h) => (h.drivers || []).map((d) => ({ ...d, host: h.host, imageTime: h.imageTime })));
  const missing = mediaDrivers ? rows.filter((d) => !mediaHasDriver(mediaDrivers, d)) : [];
  const missingHosts = [...new Set(missing.map((d) => d.host))];

  const columns = [
    {
      id: "host",
      header: "Computer",
      meta: { className: "col-source" },
      accessorFn: (x) => x.host,
      cell: (x) => (
        <>
          <span className="source-name">{x.getValue()}</span>
          <span className="source-path" title={moment(x.row.original.imageTime).toLocaleString()}>
            image of {moment(x.row.original.imageTime).fromNow()}
          </span>
        </>
      ),
    },
    {
      id: "driver",
      header: "Driver",
      accessorFn: (x) => x.inf,
      cell: (x) => (
        <>
          <span className="source-name">{x.getValue()}</span>
          <span className="source-path">{x.row.original.class}</span>
        </>
      ),
    },
    { id: "version", header: "Version", accessorFn: (x) => x.version },
  ];

  if (mediaDrivers) {
    columns.push({
      id: "media",
      header: "Recovery Media",
      accessorFn: (x) => mediaHasDriver(mediaDrivers, x),
      cell: (x) =>
        x.getValue() ? (
          <Badge bg="success">on media</Badge>
        ) : (
          <Badge bg="warning" text="dark">
            missing
          </Badge>
        ),
    });
  }

  return (
    <div data-testid="driver-inventory" className="mt-4">
      <h5>Drivers</h5>
      <p className="text-muted">
        The storage, network and USB drivers stored with the newest image of each computer. One recovery media restores
        every computer whose drivers it has: build it with{" "}
        <code>kopia image recovery-media create --drivers-from all</code>.
      </p>
      {missingHosts.length > 0 && (
        <Alert variant="warning" data-testid="driver-inventory-missing">
          <FontAwesomeIcon icon={faExclamationTriangle} /> This computer&apos;s recovery media lacks drivers of{" "}
          {missingHosts.join(", ")}, so it may not reach their disks or network.
        </Alert>
      )}
      <KopiaTable data={rows} columns={columns} />
    </div>
  );
}

/** Tells whether two computer names are the same, as kopia compares them. */
function sameHost(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Asks whose drivers to add to recovery media before building it: the media
 * restores this computer with its own drivers, and the other computers whose
 * images store drivers, when chosen, with theirs. onBuild receives the chosen
 * computers and returns a promise of the message to show.
 */
export function RecoveryMediaDialog({ show, onHide, localHost, onBuild }) {
  const [inventory, setInventory] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [message, setMessage] = useState(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    axios
      .get("/api/v1/images/drivers")
      .then((result) => setInventory(result.data.hosts || []))
      .catch(() => setInventory([]));
  }, []);

  const others = (inventory || []).filter((h) => !sameHost(h.host, localHost || ""));

  // every other computer at first
  const selected = chosen ?? others.map((h) => h.host);

  const toggle = (host, on) => setChosen(on ? [...selected, host] : selected.filter((h) => !sameHost(h, host)));

  const build = () => {
    setBuilding(true);
    setMessage(null);

    onBuild(selected)
      .then((m) => {
        if (m.variant !== "success") {
          setMessage(m);
        }
      })
      .catch((e) => setMessage({ variant: "danger", text: e.message }))
      .finally(() => setBuilding(false));
  };

  return (
    <Modal show={show} onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>Create Recovery Media</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {message && <Alert variant={message.variant}>{message.text}</Alert>}
        {inventory === null ? (
          <p>
            <Spinner size="sm" animation="border" /> Loading the drivers of the computers ...
          </p>
        ) : (
          <>
            <p>
              The media restores {localHost || "this computer"} with its own storage, network and USB drivers.
              {others.length > 0 && " To restore other computers with it too, add their drivers:"}
            </p>
            {others.length > 0 ? (
              <Form.Group className="mb-3" data-testid="media-driver-hosts">
                {others.map((h) => (
                  <Form.Check
                    key={h.host}
                    type="checkbox"
                    id={"media-drivers-" + h.host}
                    checked={selected.some((s) => sameHost(s, h.host))}
                    onChange={(e) => toggle(h.host, e.target.checked)}
                    label={
                      <span title={h.drivers.map((d) => d.class + " " + d.inf + " " + d.version).join("\n")}>
                        {h.host}{" "}
                        <span className="text-muted small">
                          {h.drivers.length} {h.drivers.length === 1 ? "driver" : "drivers"}, image of{" "}
                          {moment(h.imageTime).fromNow()}
                        </span>
                      </span>
                    }
                  />
                ))}
              </Form.Group>
            ) : (
              <p className="text-muted small" data-testid="media-no-driver-hosts">
                No image of another computer stores drivers yet: computers store them with every image they create with
                this version of kopia.
              </p>
            )}
          </>
        )}
        <p className="text-muted small mb-0">
          The media is built in a console window, which asks which USB disk to erase.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button size="sm" variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          data-testid="build-recovery-media"
          disabled={building || inventory === null}
          onClick={build}
          title="Asks for administrator rights"
        >
          {building && <Spinner size="sm" animation="border" />} Build Media
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

/**
 * Lists the disk images in the repository and, on Windows, the scheduled
 * image tasks, the last image run and the recovery media of the computer the
 * server runs on.
 */
export function Images() {
  const { bytesStringBase2 } = use(UIPreferencesContext);
  const [allHosts, setAllHosts] = useState(false);
  const [images, setImages] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingMedia, setCreatingMedia] = useState(false);
  const lastRunEndRef = useRef(undefined);

  const fetchImages = useCallback(() => {
    axios
      .get("/api/v1/images" + (allHosts ? "?all=1" : ""))
      .then((result) => setImages(result.data))
      .catch((e) => {
        redirect(e);
        setError(e);
      });
  }, [allHosts]);

  const fetchStatus = useCallback(() => {
    axios
      .get("/api/v1/images/status")
      .then((result) => {
        setStatus(result.data);

        // a run that ended added images
        const end = result.data.lastRun?.endTime;
        if (lastRunEndRef.current !== undefined && end !== lastRunEndRef.current) {
          fetchImages();
        }
        lastRunEndRef.current = end;
      })
      .catch((e) => {
        redirect(e);
        setError(e);
      });
  }, [fetchImages]);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  useEffect(() => {
    fetchStatus();
    const interval = window.setInterval(fetchStatus, statusRefreshMillis);
    return () => window.clearInterval(interval);
  }, [fetchStatus]);

  // runs an action that may ask for administrator rights, showing its message
  const act = (action, failure) => {
    setRunning(true);
    setMessage(null);

    action()
      .then(setMessage)
      .catch((e) => setMessage({ variant: "danger", text: failure + ": " + errorText(e) }))
      .finally(() => {
        setRunning(false);
        fetchStatus();
      });
  };

  const onRun = () => setCreating(true);

  // an image now never depends on the schedule: kopia image create runs in a
  // console window, whether images are scheduled, paused or not at all
  const startImage = (volumes) => {
    const started = window.kopiaUI.createImageElevated(volumes).then((result) =>
      result === "canceled"
        ? { variant: "warning", text: "The administrator prompt was declined, so no image was created." }
        : {
            variant: "success",
            text:
              "Creating images of the disks holding " +
              volumes.join(" ") +
              " in a console window, which shows the progress; closing it stops the run. The result shows here when it ends.",
          },
    );

    return started.then((m) => {
      if (m.variant === "success") {
        setCreating(false);
        setMessage(m);
        fetchStatus();
      }

      return m;
    });
  };

  // the schedule's disks, chosen at first in Create Image Now
  const scheduledVolumes = status?.schedule?.volumes;

  const onStop = () => {
    if (!window.confirm("Stop creating the image? What it uploaded so far is kept and reused by the next image.")) {
      return;
    }

    act(
      () =>
        window.kopiaUI.stopImageElevated().then((result) =>
          result === "canceled"
            ? { variant: "warning", text: "The administrator prompt was declined, so the image goes on." }
            : {
                variant: "info",
                text: "The image is stopping: it saves what it uploaded and removes its shadow copy.",
              },
        ),
      "Unable to stop the image",
    );
  };

  const onPause = (resume) =>
    act(
      () =>
        (resume ? window.kopiaUI.resumeImageSchedule() : window.kopiaUI.pauseImageSchedule()).then((result) => {
          if (result === "canceled") {
            return {
              variant: "warning",
              text: "The administrator prompt was declined, so the schedule did not change.",
            };
          }

          return resume
            ? { variant: "success", text: "The schedule is resumed: images are created on schedule again." }
            : {
                variant: "success",
                text: "The schedule is paused: no image starts on schedule, nor retries, until it is resumed. An image being created goes on.",
              };
        }),
      resume ? "Unable to resume the schedule" : "Unable to pause the schedule",
    );

  const onCreateRecoveryMedia = () => setCreatingMedia(true);

  const buildRecoveryMedia = (driverHosts) =>
    window.kopiaUI
      .createRecoveryMediaElevated(driverHosts)
      .then((result) =>
        result === "canceled"
          ? { variant: "warning", text: "The administrator prompt was declined, so no media was built." }
          : {
              variant: "success",
              text:
                "Building recovery media in a console window: it asks which USB disk to erase." +
                (driverHosts.length > 0 ? " It adds the drivers of " + driverHosts.join(", ") + "." : "") +
                " The result shows here when it ends.",
            },
      )
      .then((m) => {
        if (m.variant === "success") {
          setCreatingMedia(false);
          setMessage(m);
          fetchStatus();
        }

        return m;
      });

  const onRemove = () => {
    if (!window.confirm("Remove the scheduled image tasks? Images already created stay in the repository.")) {
      return;
    }

    act(
      () =>
        window.kopiaUI
          .removeImageSchedule()
          .then((result) =>
            result === "canceled"
              ? { variant: "warning", text: "The administrator prompt was declined, so the schedule did not change." }
              : { variant: "success", text: "The scheduled image tasks are removed." },
          ),
      "Unable to remove the schedule",
    );
  };

  // replacing the tasks' copy of kopia keeps their connection; a KopiaUI
  // without it installs the schedule again with the same settings
  const onUpdate = () =>
    act(
      () =>
        (window.kopiaUI.updateImageSchedule
          ? window.kopiaUI.updateImageSchedule()
          : window.kopiaUI.installImageSchedule(settingsFromSchedule(status.schedule))
        ).then((result) =>
          result === "canceled"
            ? { variant: "warning", text: "The administrator prompt was declined, so the tasks were not updated." }
            : { variant: "success", text: "The scheduled tasks now run this version of kopia." },
        ),
      "Unable to update the tasks",
    );

  const onSaved = (text) => {
    setEditing(false);
    setMessage({ variant: "success", text });
    fetchStatus();
  };

  if (error) {
    return <Alert variant="danger">{errorText(error)}</Alert>;
  }

  if (!images || !status) {
    return <p>Loading ...</p>;
  }

  return (
    <>
      <ImageStatus
        status={status}
        bytesStringBase2={bytesStringBase2}
        onRun={onRun}
        onEdit={() => setEditing(true)}
        onRemove={onRemove}
        onPause={onPause}
        onUpdate={onUpdate}
        onCreateRecoveryMedia={onCreateRecoveryMedia}
        onStop={onStop}
        busy={running}
        message={message}
      />
      {editing && (
        <ImageScheduleForm
          show={editing}
          initial={settingsFromSchedule(status.schedule)}
          onHide={() => setEditing(false)}
          onSaved={onSaved}
        />
      )}
      {creatingMedia && (
        <RecoveryMediaDialog
          show={creatingMedia}
          onHide={() => setCreatingMedia(false)}
          localHost={images.localHost}
          onBuild={buildRecoveryMedia}
        />
      )}
      {creating && (
        <CreateImageDialog
          show={creating}
          onHide={() => setCreating(false)}
          scheduledVolumes={scheduledVolumes}
          onStart={startImage}
        />
      )}
      <Row className="mb-2">
        <Col>
          <h5>Images</h5>
        </Col>
        <Col xs="auto">
          <Form.Check
            type="switch"
            id="images-all-hosts"
            label="All computers"
            checked={allHosts}
            onChange={(e) => setAllHosts(e.target.checked)}
          />
        </Col>
      </Row>
      {images.images.length === 0 ? (
        <Alert variant="info">
          <FontAwesomeIcon icon={faInfoCircle} /> No disk images{allHosts ? "" : " of " + images.localHost} yet.
        </Alert>
      ) : (
        <KopiaTable
          data={images.images}
          columns={imageColumns(bytesStringBase2, new Set(images.images.map((i) => i.source.host)).size > 1)}
        />
      )}
      <DriverInventory mediaDrivers={status.recoveryMedia?.drivers} />
    </>
  );
}
