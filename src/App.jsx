import "bootstrap/dist/css/bootstrap.min.css";
import "./css/Theme.css";
import "./css/App.css";
import "./css/linear-theme.css";
import axios from "axios";
import { React, Component } from "react";
import { Container } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCamera, faDatabase, faGear, faHardDrive, faListCheck } from "@fortawesome/free-solid-svg-icons";
import { BrowserRouter as Router, NavLink, Navigate, Route, Routes } from "react-router";
import { Images } from "./pages/Images";
import { Policy } from "./pages/Policy";
import { Preferences } from "./pages/Preferences";
import { Policies } from "./pages/Policies";
import { Repository } from "./pages/Repository";
import { Task } from "./pages/Task";
import { Tasks } from "./pages/Tasks";
import { Snapshots } from "./pages/Snapshots";
import { SnapshotCreate } from "./pages/SnapshotCreate";
import { SnapshotDirectory } from "./pages/SnapshotDirectory";
import { SnapshotHistory } from "./pages/SnapshotHistory";
import { SnapshotRestore } from "./pages/SnapshotRestore";
import { AppContext } from "./contexts/AppContext";
import { UIPreferenceProvider } from "./contexts/UIPreferencesContext";
import { RepositorySelector } from "./components/RepositorySelector";

const SIDEBAR_ITEMS = [
  { to: "/snapshots", label: "File Snapshots", testid: "tab-snapshots", icon: faCamera, needsRepository: true },
  { to: "/images", label: "Disk Images", testid: "tab-images", icon: faHardDrive, needsRepository: true },
  { to: "/tasks", label: "Tasks", testid: "tab-tasks", icon: faListCheck, needsRepository: true },
  { to: "/repo", label: "Repository", testid: "tab-repo", icon: faDatabase, needsRepository: false },
  { to: "/preferences", label: "Preferences", testid: "tab-preferences", icon: faGear, needsRepository: false },
];

export default class App extends Component {
  constructor() {
    super();

    this.state = {
      runningTaskCount: 0,
      isFetching: false,
      repoDescription: "",
      isRepositoryConnected: false,
    };

    this.fetchTaskSummary = this.fetchTaskSummary.bind(this);
    this.repositoryUpdated = this.repositoryUpdated.bind(this);
    this.repositoryDescriptionUpdated = this.repositoryDescriptionUpdated.bind(this);
    this.fetchInitialRepositoryDescription = this.fetchInitialRepositoryDescription.bind(this);

    const tok = document.head.querySelector('meta[name="kopia-csrf-token"]');
    if (tok && tok.content) {
      axios.defaults.headers.common["X-Kopia-Csrf-Token"] = tok.content;
    } else {
      axios.defaults.headers.common["X-Kopia-Csrf-Token"] = "-";
    }
  }

  componentDidMount() {
    const av = document.getElementById("appVersion");
    if (av) {
      // show app version after mounting the component to avoid flashing of unstyled content.
      av.style.display = "block";
    }

    this.fetchInitialRepositoryDescription();
    this.taskSummaryInterval = window.setInterval(this.fetchTaskSummary, 5000);
  }

  fetchInitialRepositoryDescription() {
    axios
      .get("/api/v1/repo/status")
      .then((result) => {
        if (result.data.description) {
          this.setState({
            repoDescription: result.data.description,
            isRepositoryConnected: result.data.connected,
          });
        }
      })
      .catch((_) => {
        /* ignore */
      });
  }

  fetchTaskSummary() {
    if (!this.state.isFetching) {
      this.setState({ isFetching: true });
      axios
        .get("/api/v1/tasks-summary")
        .then((result) => {
          this.setState({
            isFetching: false,
            runningTaskCount: result.data["RUNNING"] || 0,
          });
        })
        .catch((_) => {
          this.setState({ isFetching: false, runningTaskCount: -1 });
        });
    }
  }

  componentWillUnmount() {
    window.clearInterval(this.taskSummaryInterval);
  }

  // this is invoked via AppContext whenever repository is connected, disconnected, etc.
  repositoryUpdated(isConnected) {
    this.setState({ isRepositoryConnected: isConnected });
    if (isConnected) {
      window.location.replace("/snapshots");
    } else {
      window.location.replace("/repo");
    }
  }

  repositoryDescriptionUpdated(desc) {
    this.setState({
      repoDescription: desc,
    });
  }

  render() {
    const { uiPrefs, runningTaskCount, isRepositoryConnected } = this.state;

    return (
      <Router>
        <AppContext value={this}>
          <UIPreferenceProvider initalValue={uiPrefs}>
            <div className="app-shell">
              <nav className="app-sidebar" aria-label="Main">
                <NavLink to="/" className="app-sidebar-brand" title="KopiaUI">
                  <img src="/kopia-flat.svg" className="App-logo" alt="logo" />
                </NavLink>
                <RepositorySelector />
                <div className="app-sidebar-nav">
                  {SIDEBAR_ITEMS.map((item) => {
                    const enabled = isRepositoryConnected || !item.needsRepository;
                    return (
                      <span
                        key={item.to}
                        className="app-sidebar-item"
                        title={enabled ? item.label : "Repository is not connected"}
                      >
                        <NavLink
                          data-testid={item.testid}
                          className={enabled ? "nav-link" : "nav-link disabled"}
                          aria-disabled={!enabled}
                          to={item.to}
                        >
                          <FontAwesomeIcon icon={item.icon} className="app-sidebar-icon" />
                          <span className="app-sidebar-label">{item.label}</span>
                          {item.to === "/tasks" && runningTaskCount > 0 && (
                            <span className="app-sidebar-count">{runningTaskCount}</span>
                          )}
                        </NavLink>
                      </span>
                    );
                  })}
                </div>
              </nav>

              <main className="app-main">
                <Container fluid>
                  <NavLink to="/repo" className="app-repo-description">
                    <h5 className="mb-4">{this.state.repoDescription}</h5>
                  </NavLink>

                  <Routes>
                    <Route path="snapshots" element={<Snapshots />} />
                    <Route path="snapshots/new" element={<SnapshotCreate />} />
                    <Route path="snapshots/single-source/" element={<SnapshotHistory />} />
                    <Route path="snapshots/dir/:oid/restore" element={<SnapshotRestore />} />
                    <Route path="snapshots/dir/:oid" element={<SnapshotDirectory />} />
                    <Route path="images" element={<Images />} />
                    <Route path="policies/edit/" element={<Policy />} />
                    <Route path="policies" element={<Policies />} />
                    <Route path="tasks/:tid" element={<Task />} />
                    <Route path="tasks" element={<Tasks />} />
                    <Route path="repo" element={<Repository />} />
                    <Route path="preferences" element={<Preferences />} />
                    <Route path="/" element={<Navigate to="/snapshots" />} />
                  </Routes>
                </Container>
              </main>
            </div>
          </UIPreferenceProvider>
        </AppContext>
      </Router>
    );
  }
}
