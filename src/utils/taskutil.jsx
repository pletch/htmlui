import { faBan, faCheck, faExclamationCircle, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import axios from "axios";
import React from "react";
import Badge from "react-bootstrap/Badge";
import Spinner from "react-bootstrap/Spinner";
import { formatDuration } from "./formatutils";

const STATUS_PILLS = {
  RUNNING: { bg: "primary", label: "running", prefix: "for" },
  SUCCESS: { bg: "success", label: "succeeded", prefix: "took" },
  FAILED: { bg: "danger", label: "failed", prefix: "after" },
  CANCELED: { bg: "secondary", label: "canceled", prefix: "after" },
};

/**
 * Shows a task's status as a pill with its duration under it; a running task
 * also gets a spinner and a button to cancel it.
 * @param {object} task - a task from /api/v1/tasks
 */
export function taskStatusPill(task) {
  const pill = STATUS_PILLS[task.status];
  if (!pill) {
    return <Badge bg="secondary">{String(task.status || "").toLowerCase()}</Badge>;
  }

  const dur = formatDuration(task.startTime, task.endTime, true);
  return (
    <>
      <span className="time-last task-status">
        {task.status === "RUNNING" && <Spinner animation="border" variant="primary" size="sm" />}
        <Badge bg={pill.bg} data-testid="task-status">
          {pill.label}
        </Badge>
        {task.status === "RUNNING" && (
          <button
            className="btn btn-sm btn-link task-cancel"
            type="button"
            title="Cancel task"
            aria-label="Cancel task"
            onClick={() => cancelTask(task.id)}
          >
            <FontAwesomeIcon color="red" icon={faXmark} />
          </button>
        )}
      </span>
      {dur && (
        <span className="time-next">
          {pill.prefix} {dur}
        </span>
      )}
    </>
  );
}

export function cancelTask(tid) {
  axios
    .post("/api/v1/tasks/" + tid + "/cancel", {})
    .then((_result) => {})
    .catch((_error) => {});
}

export function taskStatusSymbol(task) {
  const st = task.status;
  const dur = formatDuration(task.startTime, task.endTime, true);

  switch (st) {
    case "RUNNING":
      return (
        <>
          <Spinner animation="border" variant="primary" size="sm" /> Running for {dur}
          <button className="btn btn-sm btn-link" type="button" onClick={() => cancelTask(task.id)}>
            <FontAwesomeIcon color="red" size="lg" title="Cancel task" icon={faXmark} />
          </button>
        </>
      );
    case "SUCCESS":
      return (
        <p title={dur}>
          <FontAwesomeIcon icon={faCheck} color="green" /> Finished in {dur}
        </p>
      );

    case "FAILED":
      return (
        <p title={dur}>
          <FontAwesomeIcon icon={faExclamationCircle} color="red" /> Failed after {dur}
        </p>
      );

    case "CANCELED":
      return (
        <p title={dur}>
          <FontAwesomeIcon icon={faBan} /> Canceled after {dur}
        </p>
      );

    default:
      return st;
  }
}
