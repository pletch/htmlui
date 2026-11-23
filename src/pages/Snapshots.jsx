import { faSync, faUserFriends } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import axios from "axios";
import moment from "moment";
import React, { Component } from "react";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Col from "react-bootstrap/Col";
import Dropdown from "react-bootstrap/Dropdown";
import Row from "react-bootstrap/Row";
import ProgressBar from "react-bootstrap/ProgressBar";
import Spinner from "react-bootstrap/Spinner";
import Tab from "react-bootstrap/Tab";
import Tabs from "react-bootstrap/Tabs";
import { Link } from "react-router";
import { FileSnapshotSettings, fileSettingsTabs } from "../components/FileSnapshotSettings";
import KopiaTable from "../components/KopiaTable";
import { baseName, compare, formatOwnerName, sizeDisplayName } from "../utils/formatutils";
import { errorAlert, redirect, newDataBytesCell, snapshotSizeCell, uploadedBytesCell } from "../utils/uiutil";
import { folderPolicyURL, sourceQueryStringParams } from "../utils/policyutil";
import { CLIEquivalent } from "../components/CLIEquivalent";
import { UIPreferencesContext } from "../contexts/UIPreferencesContext";
import { isImageSource } from "../utils/imageutil";

const localSnapshots = "Local Snapshots";
const allSnapshots = "All Snapshots";

/** Returns the tab the URL asks for, or the snapshot list. */
export function initialTab() {
  const t = new URLSearchParams(window.location.search).get("tab");
  return fileSettingsTabs.some((x) => x.key === t) ? t : "snapshots";
}

/**
 * Shows a source as its folder name with the full path, and the owner when
 * sources of several owners are listed, under it.
 */
function sourceCell(source, showOwner) {
  const name = baseName(source.path);
  return (
    <Link
      className="source-link"
      to={"/snapshots/single-source?" + sourceQueryStringParams(source)}
      title={formatOwnerName(source) + ":" + source.path}
    >
      {name && <span className="source-name">{name}</span>}
      <span className="source-path">{source.path}</span>
      {showOwner && <span className="source-owner">{formatOwnerName(source)}</span>}
    </Link>
  );
}

export class Snapshots extends Component {
  constructor() {
    super();
    this.state = {
      sources: [],
      isLoading: true,
      isFetching: false,
      isRefreshing: false,
      error: null,

      localSourceName: "",
      multiUser: false,
      selectedOwner: null,
      selectedDirectory: "",

      // the open tab; links can open another with /snapshots?tab=<key>
      tab: initialTab(),
      // the computer whose settings the settings tabs edit; null is this one
      settingsTarget: null,
    };

    this.sync = this.sync.bind(this);
    this.fetchSourcesWithoutSpinner = this.fetchSourcesWithoutSpinner.bind(this);

    this.cancelSnapshot = this.cancelSnapshot.bind(this);
    this.startSnapshot = this.startSnapshot.bind(this);
  }

  componentDidMount() {
    const { defaultSnapshotViewAll } = this.context;
    // Context is not available early enough in the constructor for preference-driven defaults.
    // eslint-disable-next-line @eslint-react/no-set-state-in-component-did-mount -- needs this.context
    this.setState({
      selectedOwner: defaultSnapshotViewAll ? allSnapshots : localSnapshots,
    });
    this.fetchSourcesWithoutSpinner();
    this.interval = window.setInterval(this.fetchSourcesWithoutSpinner, 3000);
  }

  componentWillUnmount() {
    window.clearInterval(this.interval);
  }

  fetchSourcesWithoutSpinner() {
    if (!this.state.isFetching) {
      this.setState({
        isFetching: true,
      });
      axios
        .get("/api/v1/sources")
        .then((result) => {
          this.setState({
            localSourceName: result.data.localUsername + "@" + result.data.localHost,
            multiUser: result.data.multiUser,
            sources: result.data.sources,
            isLoading: false,
            isFetching: false,
            isRefreshing: false,
          });
        })
        .catch((error) => {
          redirect(error);
          this.setState({
            error,
            isRefreshing: false,
            isFetching: false,
            isLoading: false,
          });
        });
    }
  }

  selectOwner(owner) {
    const { setDefaultSnapshotViewAll } = this.context;
    this.setState({ selectedOwner: owner });
    if (owner === localSnapshots) {
      setDefaultSnapshotViewAll(false);
    } else if (owner === allSnapshots) {
      setDefaultSnapshotViewAll(true);
    }
  }

  sync() {
    this.setState({ isRefreshing: true });
    axios
      .post("/api/v1/repo/sync", {})
      .then((_result) => {
        this.fetchSourcesWithoutSpinner();
      })
      .catch((error) => {
        errorAlert(error);
        this.setState({
          error,
          isRefreshing: false,
        });
      });
  }

  /**
   * Sets the header of an cell dynamically based on it's status
   * @param x - the cell which status is interpreted
   * @returns - the header of the cell
   */
  setHeader(x) {
    switch (x.cell.getValue()) {
      case "IDLE":
      case "PAUSED":
        return (x.cell.column.Header = "Actions");
      case "PENDING":
      case "UPLOADING":
        return (x.cell.column.Header = "Status");
      default:
        return (x.cell.column.Header = "");
    }
  }

  /**
   * Sets the content an cell dynamically based on it's status
   * @param x - the cell which content is changed
   * @returns - the content of the cell
   */
  statusCell(x, parent, bytesStringBase2) {
    this.setHeader(x);
    switch (x.cell.getValue()) {
      case "IDLE":
      case "PAUSED":
        return (
          <div className="row-actions">
            <Button
              data-testid="edit-policy"
              as={Link}
              to={folderPolicyURL(x.row.original.source)}
              variant="primary"
              size="sm"
            >
              Policy
            </Button>
            <Button
              data-testid="snapshot-now"
              variant="success"
              size="sm"
              onClick={() => {
                parent.startSnapshot(x.row.original.source);
              }}
            >
              Snapshot Now
            </Button>
          </div>
        );

      case "PENDING":
        return (
          <>
            <Spinner
              data-testid="snapshot-pending"
              animation="border"
              variant="secondary"
              size="sm"
              title="Snapshot will start after the previous snapshot completes"
            />
            &nbsp;Pending
          </>
        );

      case "UPLOADING": {
        let u = x.row.original.upload;
        let title = "";
        let totals = "";
        let percent = null;
        if (u) {
          title =
            " hashed " +
            u.hashedFiles +
            " files (" +
            sizeDisplayName(u.hashedBytes, bytesStringBase2) +
            ")\n" +
            " cached " +
            u.cachedFiles +
            " files (" +
            sizeDisplayName(u.cachedBytes, bytesStringBase2) +
            ")\n" +
            " dir " +
            u.directory;

          const totalBytes = u.hashedBytes + u.cachedBytes;

          totals = sizeDisplayName(totalBytes, bytesStringBase2);
          if (u.estimatedBytes) {
            totals += "/" + sizeDisplayName(u.estimatedBytes, bytesStringBase2);

            const p = Math.round((totalBytes * 1000.0) / u.estimatedBytes) / 10.0;
            if (p <= 100) {
              percent = p;
              totals += " " + p + "%";
            }
          }
        }

        return (
          <div className="upload-progress">
            <Spinner data-testid="snapshot-uploading" animation="border" variant="primary" size="sm" title={title} />
            {percent !== null && (
              <ProgressBar
                className="upload-progress-bar"
                now={percent}
                title={percent + "%"}
                data-testid="snapshot-progress"
              />
            )}
            <span className="upload-progress-text">{totals}</span>
            {x.row.original.currentTask && <Link to={"/tasks/" + x.row.original.currentTask}>Details</Link>}
          </div>
        );
      }

      default:
        return "";
    }
  }

  cancelSnapshot(source) {
    axios
      .post("/api/v1/sources/cancel?" + sourceQueryStringParams(source), {})
      .then((_result) => {
        this.fetchSourcesWithoutSpinner();
      })
      .catch((error) => {
        errorAlert(error);
      });
  }

  startSnapshot(source) {
    axios
      .post("/api/v1/sources/upload?" + sourceQueryStringParams(source), {})
      .then((_result) => {
        this.fetchSourcesWithoutSpinner();
      })
      .catch((error) => {
        errorAlert(error);
      });
  }

  /**
   * Shows when a source is snapshotted next, under its last snapshot time.
   * @param source - the source's status entry from /api/v1/sources
   */
  nextSnapshotTimeCell(source) {
    const next = source.nextSnapshotTime;
    if (!next) {
      if (source.status === "PAUSED") {
        return (
          <span className="time-next">
            <Badge bg="secondary">paused</Badge>
          </span>
        );
      }

      return null;
    }

    if (source.status === "UPLOADING") {
      return null;
    }

    return (
      <span className="time-next" title={moment(next).toLocaleString()}>
        next {moment(next).fromNow()}
        {moment(next).isBefore(moment()) && (
          <>
            {" "}
            <Badge bg="warning">overdue</Badge>
          </>
        )}
      </span>
    );
  }

  render() {
    return (
      <Tabs
        activeKey={this.state.tab}
        onSelect={(k) => this.setState({ tab: k || "snapshots" })}
        className="mb-3"
        mountOnEnter
        // a settings tab reads the policy again each time it opens, so that
        // saving one tab never writes back what another tab read before
        unmountOnExit
        data-testid="snapshot-tabs"
      >
        <Tab eventKey="snapshots" title="Folders">
          {this.renderList()}
        </Tab>
        {fileSettingsTabs.map((t) => (
          <Tab key={t.key} eventKey={t.key} title={t.title}>
            <FileSnapshotSettings
              sections={t.sections}
              intro={t.intro}
              target={this.state.settingsTarget}
              onTarget={(k) => this.setState({ settingsTarget: k })}
            />
          </Tab>
        ))}
      </Tabs>
    );
  }

  renderList() {
    let { sources, isLoading, error } = this.state;
    const { bytesStringBase2 } = this.context;
    if (error) {
      return <p>{error.message}</p>;
    }
    if (isLoading) {
      return <Spinner animation="border" variant="primary" />;
    }

    // disk images have their own page
    sources = sources.filter((x) => !isImageSource(x.source));

    let uniqueOwners = sources.reduce((a, d) => {
      const owner = formatOwnerName(d.source);

      if (!a.includes(owner)) {
        a.push(owner);
      }
      return a;
    }, []);

    uniqueOwners.sort();

    switch (this.state.selectedOwner) {
      case allSnapshots:
        // do nothing;
        break;

      case localSnapshots:
        sources = sources.filter((x) => formatOwnerName(x.source) === this.state.localSourceName);
        break;

      default:
        sources = sources.filter((x) => formatOwnerName(x.source) === this.state.selectedOwner);
        break;
    }

    // The owner only tells rows apart when more than one is listed.
    const showOwner = new Set(sources.map((x) => formatOwnerName(x.source))).size > 1;

    const columns = [
      {
        id: "path",
        header: "Path",
        accessorFn: (x) => x.source,
        sortType: (a, b) => {
          const v = compare(a.original.source.path, b.original.source.path);
          if (v !== 0) {
            return v;
          }

          return compare(formatOwnerName(a.original.source), formatOwnerName(b.original.source));
        },
        width: "",
        meta: { className: "col-source" },
        cell: (x) => sourceCell(x.cell.getValue(), showOwner),
      },
      {
        id: "lastSnapshotSize",
        header: "Size",
        width: 120,
        meta: { className: "col-num" },
        accessorFn: (x) => x.lastSnapshot?.imageBytesRead ?? x.lastSnapshot?.stats?.totalSize ?? 0,
        cell: (x) =>
          snapshotSizeCell(
            x.row.original.lastSnapshot?.imageBytesRead,
            x.row.original.lastSnapshot?.stats?.totalSize ?? 0,
            x.row.original.lastSnapshot?.rootEntry?.summ ?? null,
            bytesStringBase2,
          ),
      },
      {
        id: "lastSnapshotNewData",
        header: "New Data",
        width: 120,
        meta: { className: "col-num" },
        accessorFn: (x) => x.lastSnapshot?.newDataBytes ?? -1,
        cell: (x) => newDataBytesCell(x.cell.getValue(), bytesStringBase2),
      },
      {
        id: "lastSnapshotUploaded",
        header: "Stored",
        width: 120,
        meta: { className: "col-num" },
        accessorFn: (x) => x.lastSnapshot?.uploadedBytes ?? -1,
        cell: (x) => uploadedBytesCell(x.cell.getValue(), bytesStringBase2),
      },
      {
        id: "lastSnapshotTime",
        header: "Last / Next",
        width: 160,
        meta: { className: "col-time" },
        accessorFn: (x) => (x.lastSnapshot ? x.lastSnapshot.startTime : null),
        cell: (x) => (
          <>
            {x.cell.getValue() ? (
              <span className="time-last" title={moment(x.cell.getValue()).toLocaleString()}>
                {moment(x.cell.getValue()).fromNow()}
              </span>
            ) : (
              <span className="time-last time-none">never</span>
            )}
            {this.nextSnapshotTimeCell(x.row.original)}
          </>
        ),
      },
      {
        id: "status",
        header: "",
        width: 300,
        meta: { className: "col-actions" },
        accessorFn: (x) => x.status,
        cell: (x) => this.statusCell(x, this, bytesStringBase2),
      },
    ];

    return (
      <>
        <div className="list-actions">
          <Row>
            {this.state.multiUser && (
              <>
                <Col xs="auto">
                  <Dropdown>
                    <Dropdown.Toggle size="sm" variant="primary" id="dropdown-basic">
                      <FontAwesomeIcon icon={faUserFriends} />
                      &nbsp;{this.state.selectedOwner}
                    </Dropdown.Toggle>

                    <Dropdown.Menu>
                      <Dropdown.Item onClick={() => this.selectOwner(localSnapshots)}>{localSnapshots}</Dropdown.Item>
                      <Dropdown.Item onClick={() => this.selectOwner(allSnapshots)}>{allSnapshots}</Dropdown.Item>
                      <Dropdown.Divider />
                      {uniqueOwners.map((v) => (
                        <Dropdown.Item key={v} onClick={() => this.selectOwner(v)}>
                          {v}
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  </Dropdown>
                </Col>
              </>
            )}
            <Col xs="auto">
              <Button data-testid="new-snapshot" size="sm" variant="primary" href="/snapshots/new">
                New Snapshot
              </Button>
            </Col>
            <Col></Col>
            <Col xs="auto">
              <Button size="sm" title="Synchronize" variant="primary">
                {this.state.isRefreshing ? (
                  <Spinner animation="border" variant="light" size="sm" />
                ) : (
                  <FontAwesomeIcon icon={faSync} onClick={this.sync} />
                )}
              </Button>
            </Col>
          </Row>
        </div>

        <KopiaTable data={sources} columns={columns} />
        <CLIEquivalent command={`snapshot list`} />
      </>
    );
  }
}
Snapshots.contextType = UIPreferencesContext;
