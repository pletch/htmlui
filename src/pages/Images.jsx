import {
  faArrowUp,
  faChevronDown,
  faFile,
  faFolder,
  faChevronRight,
  faEject,
  faExclamationTriangle,
  faFolderOpen,
  faHardDrive,
  faInfoCircle,
  faListUl,
  faSync,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import axios from "axios";
import moment from "moment";
import React, { use, useCallback, useEffect, useRef, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import ProgressBar from "react-bootstrap/ProgressBar";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import Tab from "react-bootstrap/Tab";
import Table from "react-bootstrap/Table";
import Tabs from "react-bootstrap/Tabs";
import {
  CreateImageDialog,
  ImageScheduleForm,
  scheduleSummary,
  settingsFromSchedule,
} from "../components/ImageScheduleForm";
import { CLIEquivalent } from "../components/CLIEquivalent";
import { ImageRetention } from "../components/ImageRetention";
import KopiaTable from "../components/KopiaTable";
import { UIPreferencesContext } from "../contexts/UIPreferencesContext";
import { formatDuration, sizeDisplayName } from "../utils/formatutils";
import { diskMapTiles, diskSourcePrefix, parseVolumeEntry, partitionTypeName, usedBytes } from "../utils/imageutil";
import { redirect } from "../utils/uiutil";

const statusRefreshMillis = 5000;

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
              {img.newDataBytes === undefined ? "?" : sizeDisplayName(img.newDataBytes, bytesStringBase2)}, uploaded{" "}
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

/**
 * The Schedule tab: the scheduled image tasks of the server's computer, their
 * settings and the last image run.
 */
function ScheduleTab({ status, bytesStringBase2, onEdit, onRemove, onPause, onUpdate, busy }) {
  if (!status.supported) {
    return (
      <Alert variant="info">
        <FontAwesomeIcon icon={faInfoCircle} /> Images are scheduled on Windows.
      </Alert>
    );
  }

  const createTask = status.tasks[0];
  const scheduled = createTask?.scheduled;

  return (
    <>
      <div className="image-toolbar mb-3">
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
      </div>
      {!scheduled && !createTask?.error && (
        <Alert variant="info">
          <FontAwesomeIcon icon={faInfoCircle} /> Images are not scheduled on this computer. Create one now, or set up a
          schedule to create them automatically.
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
    </>
  );
}

/**
 * Returns the path of a folder in a mounted snapshot, with the mount's own
 * separator. folder separates its names with "/".
 */
export function pathInMount(mountPath, folder) {
  if (!folder) {
    return mountPath;
  }

  const windows = /^[A-Za-z]:/.test(mountPath) || mountPath.includes("\\");
  const sep = windows ? "\\" : "/";

  return mountPath.replace(/[\\/]+$/, "") + sep + folder.split("/").filter(Boolean).join(sep);
}

/** Names a partition tile like Macrium does: its number and its drive letter, GPT name or type. */
function tileTitle(tile) {
  const v = tile.volume ? parseVolumeEntry(tile.volume.entryName) : null;
  const name = v?.letter ? "(" + v.letter + ")" : tile.name || partitionTypeName(tile.typeGuid);

  return tile.number + " - " + name;
}

/** Tells what a tile's partition holds in the image. */
function tileKind(tile) {
  if (!tile.volume) {
    return "Not imaged";
  }

  return tile.volume.kind === "ntfs" ? "NTFS" : "Imaged whole";
}

/**
 * Shows the partitions of the selected image's disk as tiles, each with how
 * full it was, like Macrium Reflect's disk map. NTFS volumes can be browsed:
 * the image is mounted and the volume's folder opened.
 */
function DiskMap({ image, showHost, bytesStringBase2, busy, onBrowse }) {
  const tiles = diskMapTiles(image);
  const size = (v) => sizeDisplayName(v, bytesStringBase2);

  return (
    <div className="disk-map mb-3" data-testid="disk-map">
      <div className="disk-map-header">
        <FontAwesomeIcon icon={faHardDrive} /> <strong>{diskDisplayName(image.source)}</strong>
        {showHost && <span className="text-muted"> on {image.source.host}</span>}
        {image.diskSize > 0 && <span className="text-muted"> &lt;{size(image.diskSize)}&gt;</span>}
        <span className="text-muted">
          {" "}
          — image of{" "}
          <span title={moment(image.startTime).toLocaleString()}>{moment(image.startTime).format("LLL")}</span>
        </span>
      </div>
      <div className="disk-map-tiles">
        {tiles.map((t) => {
          const v = t.volume;
          const used = usedBytes(v);
          const total = v ? v.size : t.length;
          const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;
          const browsable = v?.kind === "ntfs";

          return (
            <div
              key={t.number}
              className={"disk-tile" + (v ? "" : " disk-tile-skipped")}
              style={{ flexGrow: Math.max(1, Math.log2(total / (1 << 20) + 1)) }}
              data-testid={"disk-tile-" + t.number}
            >
              <div className="disk-tile-title" title={t.name}>
                {tileTitle(t)}
              </div>
              <div className="disk-tile-kind">
                {t.typeGuid ? partitionTypeName(t.typeGuid) + " · " : ""}
                {tileKind(t)}
              </div>
              <div className={"disk-usage" + (v?.kind === "raw" ? " disk-usage-whole" : "")}>
                {v && <div className="disk-usage-used" style={{ width: percent + "%" }} />}
              </div>
              <div className="disk-tile-sizes">
                {v && v.kind === "ntfs" ? (
                  <>
                    <span>{size(used)}</span>
                    <span>{size(total)}</span>
                  </>
                ) : (
                  <span>{size(total)}</span>
                )}
              </div>
              {browsable && (
                <Button
                  size="sm"
                  variant="link"
                  className="disk-tile-browse"
                  disabled={busy}
                  data-testid={"browse-volume-" + t.number}
                  onClick={() => onBrowse(image, parseVolumeEntry(v.entryName).folder)}
                  title="Mount the image as a drive and open this volume's files in the file manager"
                >
                  <FontAwesomeIcon icon={faFolderOpen} /> Mount &amp; Browse
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Groups images by disk (their source), keeping the API's order: newest first within a disk. */
export function groupImagesByDisk(images) {
  const groups = [];
  const byKey = new Map();

  for (const img of images) {
    const key = img.source.host + "@" + img.source.userName + ":" + img.source.path;
    let g = byKey.get(key);

    if (!g) {
      g = { key, source: img.source, images: [] };
      byKey.set(key, g);
      groups.push(g);
    }

    g.images.push(img);
  }

  return groups;
}

/** Finds the repository space of a disk's images in the images response. */
export function sourceSpace(space, source) {
  return (space || []).find(
    (s) => s.source.host === source.host && s.source.userName === source.userName && s.source.path === source.path,
  );
}

/** Describes the repository space of a disk's images, for its group heading. */
function SpaceSummary({ space, bytesStringBase2 }) {
  if (!space) {
    return null;
  }

  if (space.error) {
    return (
      <span className="text-muted small" data-testid="image-group-space">
        {" "}
        <FontAwesomeIcon icon={faExclamationTriangle} title={"Unable to calculate the space: " + space.error} /> space
        unknown
      </span>
    );
  }

  if (space.pending) {
    return (
      <span className="text-muted small" data-testid="image-group-space">
        {" "}
        · calculating the space on the server…
      </span>
    );
  }

  return (
    <span
      className="text-muted small"
      data-testid="image-group-space"
      title="What these images take in the repository, compressed, counting the data they share once"
    >
      {" "}
      · {sizeDisplayName(space.storedBytes, bytesStringBase2)} on the server
    </span>
  );
}

/**
 * Lists the images grouped by disk, like Macrium Reflect's backup sets. Every
 * kopia image is a complete restore point, so a group is the images of one
 * disk, newest first. New Data and Uploaded show what each run added; a
 * group's heading shows what its images take on the server together, and
 * Unique Data what only an image uses.
 */
function ImageList({ groups, space, selectedId, onSelect, mounts, showHost, bytesStringBase2 }) {
  const [collapsed, setCollapsed] = useState({});
  const size = (v) => (v === undefined ? "" : sizeDisplayName(v, bytesStringBase2));

  return (
    <Table size="sm" hover responsive className="image-list" data-testid="image-list">
      <thead>
        <tr>
          <th>Image</th>
          <th className="col-time">Started</th>
          <th className="col-num">Disk Size</th>
          <th className="col-num">Read</th>
          <th className="col-num">New Data</th>
          <th className="col-num" title="What the run that created the image uploaded, compressed">
            Uploaded
          </th>
          <th
            className="col-num"
            title="Data that no other image of this disk uses, compressed: about what deleting the image frees, once maintenance removes data that nothing uses"
          >
            Unique Data
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <React.Fragment key={g.key}>
            <tr
              className="image-group"
              onClick={() => setCollapsed({ ...collapsed, [g.key]: !collapsed[g.key] })}
              data-testid="image-group"
            >
              <td colSpan={7}>
                <FontAwesomeIcon icon={collapsed[g.key] ? faChevronRight : faChevronDown} fixedWidth />{" "}
                <FontAwesomeIcon icon={faHardDrive} />{" "}
                <span className="image-group-name">{diskDisplayName(g.source)}</span>
                {showHost && <span className="image-group-host"> on {g.source.host}</span>}
                <span className="text-muted small">
                  {" "}
                  ({g.images.length} {g.images.length === 1 ? "image" : "images"})
                </span>
                <SpaceSummary space={sourceSpace(space, g.source)} bytesStringBase2={bytesStringBase2} />
              </td>
            </tr>
            {!collapsed[g.key] &&
              g.images.map((img, i) => {
                const volumes = (img.volumes || []).map((v) => v.entryName).join(", ");
                const mounted = mounts[img.rootID];

                return (
                  <tr
                    key={img.id}
                    className={"image-row" + (img.id === selectedId ? " table-active" : "")}
                    onClick={() => onSelect(img.id)}
                    data-testid={"image-row-" + img.id}
                  >
                    <td className="col-source image-name">
                      <span className="source-name">
                        {moment(img.startTime).format("L LT")}
                        {i === 0 && (
                          <Badge bg="secondary" className="ms-2">
                            latest
                          </Badge>
                        )}
                        {mounted && (
                          <Badge bg="info" className="ms-2" title={"Mounted at " + mounted} data-testid="image-mounted">
                            mounted {mounted}
                          </Badge>
                        )}
                        {(img.pins || []).length > 0 && (
                          <Badge bg="warning" text="dark" className="ms-2" title={img.pins.join(", ")}>
                            pinned
                          </Badge>
                        )}
                        {img.metadataError && (
                          <FontAwesomeIcon
                            className="ms-2"
                            color="red"
                            icon={faExclamationTriangle}
                            title={"Unable to read the image statistics: " + img.metadataError}
                          />
                        )}
                      </span>
                      {volumes && <span className="source-path">{volumes}</span>}
                    </td>
                    <td className="col-time">
                      <span className="time-last" title={moment(img.startTime).toLocaleString()}>
                        {moment(img.startTime).fromNow()}
                      </span>
                      {img.endTime && (
                        <span className="time-next">took {formatDuration(img.startTime, img.endTime, true)}</span>
                      )}
                    </td>
                    <td className="col-num">{size(img.size)}</td>
                    <td className="col-num">{size(img.bytesRead)}</td>
                    <td className="col-num">{size(img.newDataBytes)}</td>
                    <td className="col-num">{size(img.uploadedBytes)}</td>
                    <td className="col-num" data-testid={"image-exclusive-" + img.id}>
                      {size(img.exclusiveBytes)}
                    </td>
                  </tr>
                );
              })}
          </React.Fragment>
        ))}
      </tbody>
    </Table>
  );
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
 * drivers, nor when the server cannot list them. It lists them again when
 * lastRunEnd changes: a run that ended may have stored drivers.
 */
function DriverInventory({ mediaDrivers, lastRunEnd }) {
  const [hosts, setHosts] = useState(null);

  useEffect(() => {
    axios
      .get("/api/v1/images/drivers")
      .then((result) => setHosts(result.data.hosts || []))
      .catch(() => setHosts([]));
  }, [lastRunEnd]);

  if (!hosts) {
    return null;
  }

  if (hosts.length === 0) {
    return (
      <p className="text-muted" data-testid="driver-inventory-empty">
        No image stores drivers yet: computers store their storage, network and USB drivers with every image they create
        with this version of kopia.
      </p>
    );
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
    <div data-testid="driver-inventory">
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
 * images store drivers, when chosen, with theirs. It also asks whether to
 * write a USB stick or save an ISO file. onBuild receives the chosen computers
 * and {iso, allDrivers}, and returns a promise of the message to show.
 */
export function RecoveryMediaDialog({ show, onHide, localHost, onBuild }) {
  const [inventory, setInventory] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [message, setMessage] = useState(null);
  const [building, setBuilding] = useState(false);
  const [iso, setISO] = useState(false);
  const [allDrivers, setAllDrivers] = useState(false);

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

    onBuild(allDrivers ? [] : selected, { iso, allDrivers })
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
                <Form.Check
                  type="checkbox"
                  id="media-drivers-all"
                  data-testid="media-drivers-all"
                  checked={allDrivers}
                  onChange={(e) => setAllDrivers(e.target.checked)}
                  label={
                    <span>
                      All computers{" "}
                      <span className="text-muted small">including those whose images store drivers later on</span>
                    </span>
                  }
                />
                {others.map((h) => (
                  <Form.Check
                    key={h.host}
                    type="checkbox"
                    id={"media-drivers-" + h.host}
                    className="ms-4"
                    disabled={allDrivers}
                    checked={allDrivers || selected.some((s) => sameHost(s, h.host))}
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
        <Form.Group className="mb-3" data-testid="media-target">
          <Form.Check
            type="radio"
            name="media-target"
            id="media-target-usb"
            data-testid="media-target-usb"
            checked={!iso}
            onChange={() => setISO(false)}
            label="Write it to a USB stick, which is erased"
          />
          <Form.Check
            type="radio"
            name="media-target"
            id="media-target-iso"
            data-testid="media-target-iso"
            checked={iso}
            onChange={() => setISO(true)}
            label="Save it as an ISO file, to write to a USB stick with a tool such as Rufus when needed"
          />
        </Form.Group>
        <p className="text-muted small mb-0">
          {iso
            ? "You choose where to save the ISO file, then the media is built in a console window. Write it to a USB stick with Rufus or a similar tool when needed: it does not boot as a DVD or in a virtual machine. Keep a copy away from the computers it restores."
            : "The media is built in a console window, which asks which USB disk to erase."}
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
 * The Files tab: browses the selected image without mounting it. Its root
 * shows a folder for each NTFS volume, next to the files the image consists
 * of, as a mounted image does.
 */
export function ImageFiles({ image, bytesStringBase2, busy, onBrowse }) {
  const [path, setPath] = useState([]);
  const [listing, setListing] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let canceled = false;

    axios
      .get("/api/v1/images/files", { params: { root: image.rootID, path: path.join("/") } })
      .then((result) => {
        if (!canceled) {
          setListing(result.data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!canceled) {
          setListing(null);
          setError(errorText(e));
        }
      });

    return () => {
      canceled = true;
    };
  }, [image.rootID, path]);

  const imageName = moment(image.startTime).format("L LT");
  const loading = !error && (!listing || listing.path !== path.join("/"));
  const command = "image ls " + image.id + (path.length > 0 ? "/" + path.join("/") : "") + " -l";

  return (
    <div className="image-files" data-testid="image-files-tab">
      <div className="image-files-bar mb-2">
        <nav className="image-files-path" aria-label="Folder">
          <Button
            size="sm"
            variant="link"
            className="image-files-crumb"
            onClick={() => setPath([])}
            disabled={path.length === 0}
          >
            <FontAwesomeIcon icon={faHardDrive} /> {diskDisplayName(image.source)}, {imageName}
          </Button>
          {path.map((p, i) => (
            <React.Fragment key={i}>
              <span className="image-files-sep">/</span>
              <Button
                size="sm"
                variant="link"
                className="image-files-crumb"
                onClick={() => setPath(path.slice(0, i + 1))}
                disabled={i === path.length - 1}
                data-testid={"image-files-crumb-" + i}
              >
                {p}
              </Button>
            </React.Fragment>
          ))}
        </nav>
        <div className="image-toolbar">
          <Button
            size="sm"
            variant="secondary"
            disabled={path.length === 0}
            onClick={() => setPath(path.slice(0, -1))}
            data-testid="image-files-up"
          >
            <FontAwesomeIcon icon={faArrowUp} /> Up
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onBrowse(image, path.join("/"))}
            data-testid="image-files-open"
            title="Mount the image as a drive and open this folder in the file manager"
          >
            <FontAwesomeIcon icon={faFolderOpen} /> Mount &amp; Open Here
          </Button>
        </div>
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
      {loading && (
        <p>
          <Spinner size="sm" animation="border" /> Loading ...
        </p>
      )}
      {!loading && listing && (
        <>
          {listing.truncated && (
            <Alert variant="warning">Only the first {listing.entries.length} entries of this folder are listed.</Alert>
          )}
          <Table size="sm" hover responsive className="image-files-list" data-testid="image-files-list">
            <thead>
              <tr>
                <th>Name</th>
                <th className="col-num">Size</th>
                <th className="col-time">Modified</th>
              </tr>
            </thead>
            <tbody>
              {listing.entries.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-muted">
                    This folder is empty.
                  </td>
                </tr>
              )}
              {listing.entries.map((e) => (
                <tr
                  key={e.name}
                  className={e.dir ? "image-files-dir" : undefined}
                  onClick={e.dir ? () => setPath([...path, e.name]) : undefined}
                  data-testid={"image-file-" + e.name}
                >
                  <td>
                    <span className="dir-entry">
                      <FontAwesomeIcon icon={e.dir ? faFolder : faFile} className="dir-entry-icon" />
                      {e.name}
                    </span>
                  </td>
                  <td className="col-num">{e.dir ? "" : sizeDisplayName(e.size, bytesStringBase2)}</td>
                  <td className="col-time" title={moment(e.mtime).toLocaleString()}>
                    {moment(e.mtime).format("L LT")}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      <CLIEquivalent command={command} />
    </div>
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
  const [selectedId, setSelectedId] = useState(null);
  const [diskFilter, setDiskFilter] = useState("");
  const [mounts, setMounts] = useState({});
  const [tab, setTab] = useState("images");
  const lastRunEndRef = useRef(undefined);
  const mediaBuiltRef = useRef(undefined);

  // mounted snapshots by root object, to tell which images are mounted
  const fetchMounts = useCallback(() => {
    axios
      .get("/api/v1/mounts")
      .then((result) => setMounts(Object.fromEntries((result.data.items || []).map((m) => [m.root, m.path]))))
      .catch(() => setMounts({}));
  }, []);

  useEffect(() => {
    fetchMounts();
  }, [fetchMounts]);

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

        // a run that ended added images; the message that it started is done
        const end = result.data.lastRun?.endTime;
        if (lastRunEndRef.current !== undefined && end !== lastRunEndRef.current) {
          fetchImages();
          setMessage((m) => (m?.until === "run" ? null : m));
        }
        lastRunEndRef.current = end;

        // so is the message that media is being built, once it is recorded
        const built = result.data.recoveryMedia?.builtAt ?? null;
        if (mediaBuiltRef.current !== undefined && built !== mediaBuiltRef.current) {
          setMessage((m) => (m?.until === "media" ? null : m));
        }
        mediaBuiltRef.current = built;
      })
      .catch((e) => {
        redirect(e);
        setError(e);
      });
  }, [fetchImages]);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  // the server calculates the space of the images in the background
  const spacePending = (images?.space || []).some((s) => s.pending);

  useEffect(() => {
    if (!spacePending) {
      return undefined;
    }

    const timer = window.setTimeout(fetchImages, statusRefreshMillis);
    return () => window.clearTimeout(timer);
  }, [spacePending, images, fetchImages]);

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
            until: "run",
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

  const buildRecoveryMedia = (driverHosts, options) =>
    window.kopiaUI
      .createRecoveryMediaElevated(driverHosts, options)
      .then((result) =>
        result === "canceled"
          ? {
              variant: "warning",
              text: options.iso
                ? "The save dialog or the administrator prompt was canceled, so no media was built."
                : "The administrator prompt was declined, so no media was built.",
            }
          : {
              variant: "success",
              until: "media",
              text:
                (options.iso
                  ? "Building recovery media in a console window: it saves the ISO file you chose."
                  : "Building recovery media in a console window: it asks which USB disk to erase.") +
                (options.allDrivers
                  ? " It adds the drivers of every computer whose images store them."
                  : driverHosts.length > 0
                    ? " It adds the drivers of " + driverHosts.join(", ") + "."
                    : "") +
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

  // mounts the image (once) and opens it, or one of its volume folders, in
  // the file manager; in a browser it tells where it is mounted
  const onBrowse = (img, folder) => {
    setRunning(true);
    setMessage(null);

    axios
      .post("/api/v1/mounts", { root: img.rootID })
      .then((result) => {
        const path = pathInMount(result.data.path, folder);
        fetchMounts();

        if (window.kopiaUI?.browseDirectory) {
          window.kopiaUI.browseDirectory(path);
          setMessage({ variant: "info", text: "The image is mounted at " + result.data.path + "." });
        } else {
          setMessage({ variant: "info", text: "The image is mounted: its files are in " + path + "." });
        }
      })
      .catch((e) => setMessage({ variant: "danger", text: "Unable to mount the image: " + errorText(e) }))
      .finally(() => setRunning(false));
  };

  const onUnmount = (img) => {
    setRunning(true);
    setMessage(null);

    axios
      .delete("/api/v1/mounts/" + img.rootID)
      .then(() => setMessage({ variant: "info", text: "The image is unmounted." }))
      .catch((e) => setMessage({ variant: "danger", text: "Unable to unmount the image: " + errorText(e) }))
      .finally(() => {
        setRunning(false);
        fetchMounts();
      });
  };

  const onDelete = (img) => {
    if (
      !window.confirm(
        "Delete the image of " +
          moment(img.startTime).format("LLL") +
          "? The data that other images share stays until they are deleted too.",
      )
    ) {
      return;
    }

    setRunning(true);
    setMessage(null);

    const unmounted = mounts[img.rootID] ? axios.delete("/api/v1/mounts/" + img.rootID) : Promise.resolve();

    unmounted
      .then(() =>
        axios.post("/api/v1/snapshots/delete", {
          source: img.source,
          snapshotManifestIds: [img.id],
        }),
      )
      .then(() => {
        setMessage({ variant: "success", text: "The image is deleted." });
        setSelectedId(null);
        fetchImages();
      })
      .catch((e) => setMessage({ variant: "danger", text: "Unable to delete the image: " + errorText(e) }))
      .finally(() => {
        setRunning(false);
        fetchMounts();
      });
  };

  const onRefresh = () => {
    fetchImages();
    fetchStatus();
    fetchMounts();
  };

  if (error) {
    return <Alert variant="danger">{errorText(error)}</Alert>;
  }

  if (!images || !status) {
    return <p>Loading ...</p>;
  }

  const disks = groupImagesByDisk(images.images);
  const groups = diskFilter ? disks.filter((g) => g.key === diskFilter) : disks;
  const visible = groups.flatMap((g) => g.images);
  const selected = visible.find((i) => i.id === selectedId) || visible[0] || null;
  const showHost = new Set(images.images.map((i) => i.source.host)).size > 1;
  const createTask = status.tasks[0];
  const taskRunning = createTask?.status === "Running";

  return (
    <>
      <Row className="mb-2 align-items-center">
        <Col>
          <h4 className="mb-0">Disk Images</h4>
        </Col>
        {status.supported && (
          <Col xs="auto">
            <Button
              size="sm"
              variant="primary"
              data-testid="run-image-task"
              disabled={taskRunning || running || !!status.progress}
              onClick={onRun}
              title="Create images of this computer's disks now, with or without a schedule; asks for administrator rights"
            >
              {running || taskRunning ? <Spinner size="sm" animation="border" /> : null} Create Image Now
            </Button>
          </Col>
        )}
      </Row>
      {!status.supported && (
        <Alert variant="info">
          <FontAwesomeIcon icon={faInfoCircle} /> Disk images are created on Windows. Images of this repository&apos;s
          Windows computers are listed below.
        </Alert>
      )}
      {message && <Alert variant={message.variant}>{message.text}</Alert>}
      {status.supported && <FailedStart status={status} />}
      {status.progress && (
        <RunProgress progress={status.progress} bytesStringBase2={bytesStringBase2} busy={running} onStop={onStop} />
      )}
      <Tabs
        activeKey={tab}
        onSelect={(k) => setTab(k || "images")}
        className="mb-3 image-tabs"
        data-testid="image-tabs"
      >
        <Tab eventKey="images" title="Images">
          {selected && (
            <DiskMap
              image={selected}
              showHost={showHost}
              bytesStringBase2={bytesStringBase2}
              busy={running}
              onBrowse={onBrowse}
            />
          )}
          <div className="image-filters mb-2">
            <Form.Check
              type="switch"
              id="images-all-hosts"
              label="All computers"
              checked={allHosts}
              onChange={(e) => {
                setAllHosts(e.target.checked);
                setDiskFilter("");
              }}
            />
            <Form.Select
              size="sm"
              className="image-disk-filter"
              value={diskFilter}
              onChange={(e) => setDiskFilter(e.target.value)}
              data-testid="image-disk-filter"
              aria-label="Disk"
            >
              <option value="">All disks</option>
              {disks.map((g) => (
                <option key={g.key} value={g.key}>
                  {diskDisplayName(g.source)}
                  {showHost ? " on " + g.source.host : ""}
                </option>
              ))}
            </Form.Select>
          </div>
          <div className="image-toolbar mb-2" data-testid="image-toolbar">
            <Button size="sm" variant="secondary" onClick={onRefresh} disabled={running} title="Refresh">
              <FontAwesomeIcon icon={faSync} /> Refresh
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selected || running}
              onClick={() => onBrowse(selected)}
              data-testid="browse-image"
              title="Mount the image as a drive and open it in the file manager: each NTFS volume is a folder"
            >
              <FontAwesomeIcon icon={faFolderOpen} /> Mount &amp; Browse
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selected || running || !mounts[selected.rootID]}
              onClick={() => onUnmount(selected)}
              data-testid="unmount-image"
            >
              <FontAwesomeIcon icon={faEject} /> Unmount
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selected}
              onClick={() => setTab("files")}
              data-testid="image-files"
              title="Browse the image's files here, without mounting it"
            >
              <FontAwesomeIcon icon={faListUl} /> Files
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!selected || running}
              onClick={() => onDelete(selected)}
              data-testid="delete-image"
            >
              <FontAwesomeIcon icon={faTrash} /> Delete
            </Button>
          </div>
          {images.images.length === 0 ? (
            <Alert variant="info">
              <FontAwesomeIcon icon={faInfoCircle} /> No disk images{allHosts ? "" : " of " + images.localHost} yet.
            </Alert>
          ) : (
            <ImageList
              groups={groups}
              space={images.space}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              mounts={mounts}
              showHost={showHost}
              bytesStringBase2={bytesStringBase2}
            />
          )}
          <CLIEquivalent command={"image list" + (allHosts ? " --all" : "")} />
        </Tab>
        <Tab eventKey="files" title="Files" mountOnEnter>
          {selected ? (
            <ImageFiles
              key={selected.id}
              image={selected}
              bytesStringBase2={bytesStringBase2}
              busy={running}
              onBrowse={onBrowse}
            />
          ) : (
            <Alert variant="info">
              <FontAwesomeIcon icon={faInfoCircle} /> Select an image on the Images tab to browse its files.
            </Alert>
          )}
        </Tab>
        <Tab eventKey="schedule" title="Schedule">
          <ScheduleTab
            status={status}
            bytesStringBase2={bytesStringBase2}
            onEdit={() => setEditing(true)}
            onRemove={onRemove}
            onPause={onPause}
            onUpdate={onUpdate}
            busy={running}
          />
        </Tab>
        <Tab eventKey="retention" title="Retention" mountOnEnter>
          <ImageRetention disks={disks} titleOf={diskDisplayName} />
        </Tab>
        <Tab eventKey="media" title="Recovery Media">
          {status.supported ? (
            <RecoveryMedia status={status} busy={running} onCreate={onCreateRecoveryMedia} />
          ) : (
            <Alert variant="info">
              <FontAwesomeIcon icon={faInfoCircle} /> Recovery media is built on Windows.
            </Alert>
          )}
          <CLIEquivalent command="image recovery-media status" />
        </Tab>
        <Tab eventKey="drivers" title="Drivers">
          <DriverInventory mediaDrivers={status.recoveryMedia?.drivers} lastRunEnd={status.lastRun?.endTime} />
          <CLIEquivalent command="image drivers" />
        </Tab>
      </Tabs>
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
    </>
  );
}
