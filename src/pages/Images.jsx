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

function TaskRow({ task }) {
  if (task.error) {
    return (
      <tr>
        <td>{task.name}</td>
        <td colSpan={4} className="text-danger">
          {task.error}
        </td>
      </tr>
    );
  }

  if (!task.scheduled) {
    return (
      <tr>
        <td>{task.name}</td>
        <td colSpan={4}>Not scheduled</td>
      </tr>
    );
  }

  if (task.statusHidden) {
    return (
      <tr>
        <td>{task.name}</td>
        <td colSpan={4} data-testid="task-status-hidden">
          Scheduled{" "}
          <span className="text-muted">
            (Task Scheduler shows the status of tasks that run as SYSTEM only to administrators)
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{task.name}</td>
      <td>{task.status}</td>
      <td>{task.nextRunTime}</td>
      <td>{task.lastRunTime}</td>
      <td>{taskResultDisplayName(task.lastResult)}</td>
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
              {img.source}: read {sizeDisplayName(img.bytesRead, bytesStringBase2)}, uploaded{" "}
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
          system disk can only be restored from a Linux live system.
        </Alert>
      </>
    );
  }

  return (
    <>
      {heading}
      <p>
        Built <span title={moment(media.builtAt).toLocaleString()}>{moment(media.builtAt).fromNow()}</span> with kopia{" "}
        {media.kopiaVersion}, written to {media.target}.
        {media.passwordEmbedded && " It holds the repository password: keep it safe."}
      </p>
      {findings.length > 0 && (
        <Alert variant="warning" data-testid="recovery-media-findings">
          <FontAwesomeIcon icon={faExclamationTriangle} /> The recovery media no longer matches this computer; build new
          media.
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

function imageColumns(bytesStringBase2, showHost) {
  const size = (v) => (v === undefined ? "" : sizeDisplayName(v, bytesStringBase2));

  const columns = [
    {
      id: "startTime",
      header: "Start Time",
      width: 160,
      accessorFn: (x) => x.startTime,
      cell: (x) => (
        <Link to={objectLink(x.row.original.rootID)} title={moment(x.getValue()).toLocaleString()}>
          {moment(x.getValue()).fromNow()}
        </Link>
      ),
    },
    {
      id: "disk",
      header: "Disk",
      accessorFn: (x) => diskDisplayName(x.source),
      cell: (x) => (
        <>
          {x.getValue()}
          {x.row.original.metadataError && (
            <>
              {" "}
              <FontAwesomeIcon
                color="red"
                icon={faExclamationTriangle}
                title={"Unable to read the image statistics: " + x.row.original.metadataError}
              />
            </>
          )}
        </>
      ),
    },
    {
      id: "volumes",
      header: "Volumes",
      accessorFn: (x) => (x.volumes || []).map((v) => v.entryName).join(", "),
    },
    {
      id: "duration",
      header: "Duration",
      accessorFn: (x) => formatDuration(x.startTime, x.endTime, true),
    },
    { id: "size", header: "Size", accessorFn: (x) => x.size, cell: (x) => size(x.getValue()) },
    { id: "read", header: "Read", accessorFn: (x) => x.bytesRead, cell: (x) => size(x.getValue()) },
    {
      id: "uploaded",
      header: "Uploaded",
      accessorFn: (x) => x.uploadedBytes,
      cell: (x) => size(x.getValue()),
    },
  ];

  if (showHost) {
    columns.splice(1, 0, {
      id: "host",
      header: "Computer",
      accessorFn: (x) => x.source.host,
    });
  }

  return columns;
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

  const onCreateRecoveryMedia = () =>
    act(
      () =>
        window.kopiaUI.createRecoveryMediaElevated().then((result) =>
          result === "canceled"
            ? { variant: "warning", text: "The administrator prompt was declined, so no media was built." }
            : {
                variant: "success",
                text: "Building recovery media in a console window: it asks which USB disk to erase. The result shows here when it ends.",
              },
        ),
      "Unable to start building recovery media",
    );

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
        <KopiaTable data={images.images} columns={imageColumns(bytesStringBase2, allHosts)} />
      )}
    </>
  );
}
