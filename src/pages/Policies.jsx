import { faUserFriends } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import axios from "axios";
import React, { Component } from "react";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Col from "react-bootstrap/Col";
import Dropdown from "react-bootstrap/Dropdown";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import { Link, useNavigate } from "react-router";
import { handleChange } from "../forms";
import { OptionalDirectory } from "../forms/OptionalDirectory";
import KopiaTable from "../components/KopiaTable";
import { CLIEquivalent } from "../components/CLIEquivalent";
import { baseName, compare, formatOwnerName } from "../utils/formatutils";
import { redirect } from "../utils/uiutil";
import { checkPolicyPath, policyEditorURL } from "../utils/policyutil";
import PropTypes from "prop-types";

const applicablePolicies = "Applicable Policies";
const localPolicies = "Local Path Policies";
const allPolicies = "All Policies";
const globalPolicy = "Global Policy";
const perUserPolicies = "Per-User Policies";
const perHostPolicies = "Per-Host Policies";

/**
 * Classifies a policy target. rank orders the scopes from the widest to the narrowest.
 * @param {object} target - the policy target ({userName, host, path})
 * @returns {{rank: number, label: string}}
 */
export function policyScope(target) {
  if (target.path) {
    return { rank: 3, label: "Folder" };
  }
  if (target.userName) {
    return { rank: 2, label: "User" };
  }
  if (target.host) {
    return { rank: 1, label: "Host" };
  }
  return { rank: 0, label: "Global" };
}

/**
 * Shows what a policy applies to: a name, and under it what that covers
 * (or the full path and, when several are listed, the owner of a folder policy).
 */
function policyTargetCell(target, showOwner) {
  let name;
  let detail;
  switch (policyScope(target).rank) {
    case 0:
      name = "Global policy";
      detail = "Every user, host and folder";
      break;
    case 1:
      name = target.host;
      detail = "Every user on this host";
      break;
    case 2:
      name = formatOwnerName(target);
      detail = "Every folder of this user";
      break;
    default:
      name = baseName(target.path);
      detail = target.path;
      break;
  }

  return (
    <Link
      className="source-link"
      to={policyEditorURL(target)}
      title={formatOwnerName(target) + ":" + (target.path || "")}
    >
      {name && <span className="source-name">{name}</span>}
      <span className="source-path">{detail}</span>
      {showOwner && target.path && <span className="source-owner">{formatOwnerName(target)}</span>}
    </Link>
  );
}

export class PoliciesInternal extends Component {
  constructor() {
    super();
    this.state = {
      policies: [],
      isLoading: true,
      error: null,
      editorTarget: null,
      selectedOwner: applicablePolicies,
      policyPath: "",
      sources: [],
    };

    this.editPolicyForPath = this.editPolicyForPath.bind(this);
    this.handleChange = handleChange.bind(this);
    this.fetchPolicies = this.fetchPolicies.bind(this);
    this.fetchSourcesWithoutSpinner = this.fetchSourcesWithoutSpinner.bind(this);
  }

  componentDidMount() {
    this.fetchPolicies();
    this.fetchSourcesWithoutSpinner();
  }

  sync() {
    this.fetchPolicies();

    axios
      .post("/api/v1/repo/sync", {})
      .then((_) => {
        this.fetchSourcesWithoutSpinner();
      })
      .catch((error) => {
        this.setState({
          error,
          isLoading: false,
        });
      });
  }

  fetchPolicies() {
    axios
      .get("/api/v1/policies")
      .then((result) => {
        this.setState({
          policies: result.data.policies,
          isLoading: false,
        });
      })
      .catch((error) => {
        redirect(error);
        this.setState({
          error,
          isLoading: false,
        });
      });
  }

  fetchSourcesWithoutSpinner() {
    axios
      .get("/api/v1/sources")
      .then((result) => {
        this.setState({
          localSourceName: result.data.localUsername + "@" + result.data.localHost,
          localUsername: result.data.localUsername,
          localHost: result.data.localHost,
          multiUser: result.data.multiUser,
          sources: result.data.sources,
          isLoading: false,
        });
      })
      .catch((error) => {
        redirect(error);
        this.setState({
          error,
          isLoading: false,
        });
      });
  }

  editPolicyForPath(e) {
    e.preventDefault();

    if (!this.state.policyPath) {
      return;
    }

    const error = checkPolicyPath(this.state.policyPath, this.state.localHost, this.state.localUsername);

    if (error) {
      alert(
        error +
          "\nMust be either an absolute path, `user@host:/absolute/path`, `user@host` or `@host`. Use backslashes on Windows.",
      );
      return;
    }

    this.props.navigate(
      policyEditorURL({
        userName: this.state.localUsername,
        host: this.state.localHost,
        path: this.state.policyPath,
      }),
    );
  }

  selectOwner(h) {
    this.setState({
      selectedOwner: h,
    });
  }

  policySummary(policies) {
    let bits = [];
    /**
     * Check if the object is empty
     * @param {*} obj
     * @returns true if the object is empty
     */
    function isEmptyObject(obj) {
      return (
        Object.getPrototypeOf(obj) === Object.prototype &&
        Object.getOwnPropertyNames(obj).length === 0 &&
        Object.getOwnPropertySymbols(obj).length === 0
      );
    }
    /**
     * Check if object has it's key as a property.
     * However, if the object itself is a set of sets, it has to be checked by isEmptyObject()
     * @param {*} obj
     * @returns
     */
    function isEmpty(obj) {
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) return isEmptyObject(obj[key]);
      }
      return true;
    }
    for (let pol in policies.policy) {
      if (!isEmpty(policies.policy[pol])) {
        bits.push(
          <Badge bg="policy-badge" key={pol}>
            {pol}
          </Badge>,
        );
      }
    }
    return bits;
  }

  isGlobalPolicy(x) {
    return !x.target.userName && !x.target.host && !x.target.path;
  }

  isLocalHostPolicy(x) {
    return !x.target.userName && x.target.host === this.state.localHost && !x.target.path;
  }

  isLocalUserPolicy(x) {
    return formatOwnerName(x.target) === this.state.localSourceName;
  }

  render() {
    let { policies, sources, isLoading, error } = this.state;
    if (error) {
      return <p>{error.message}</p>;
    }
    if (isLoading) {
      return <p>Loading ...</p>;
    }

    let uniqueOwners = sources.reduce((a, d) => {
      const owner = formatOwnerName(d.source);

      if (!a.includes(owner)) {
        a.push(owner);
      }
      return a;
    }, []);

    uniqueOwners.sort();

    switch (this.state.selectedOwner) {
      case allPolicies:
        // do nothing;
        break;

      case globalPolicy:
        policies = policies.filter((x) => this.isGlobalPolicy(x));
        break;

      case localPolicies:
        policies = policies.filter((x) => this.isLocalUserPolicy(x));
        break;

      case applicablePolicies:
        policies = policies.filter(
          (x) => this.isLocalUserPolicy(x) || this.isLocalHostPolicy(x) || this.isGlobalPolicy(x),
        );
        break;

      case perUserPolicies:
        policies = policies.filter((x) => !!x.target.userName && !!x.target.host && !x.target.path);
        break;

      case perHostPolicies:
        policies = policies.filter((x) => !x.target.userName && !!x.target.host && !x.target.path);
        break;

      default:
        policies = policies.filter((x) => formatOwnerName(x.target) === this.state.selectedOwner);
        break;
    }

    policies.sort((l, r) => {
      const hc = compare(l.target.host, r.target.host);
      if (hc) {
        return hc;
      }
      const uc = compare(l.target.userName, r.target.userName);
      if (uc) {
        return uc;
      }
      return compare(l.target.path, r.target.path);
    });

    // The owner only tells folder policies apart when more than one owner is listed.
    const showOwner = new Set(policies.filter((x) => x.target.path).map((x) => formatOwnerName(x.target))).size > 1;

    const columns = [
      {
        id: "target",
        header: "Applies To",
        meta: { className: "col-source" },
        accessorFn: (x) => policyScope(x.target).rank + ":" + formatOwnerName(x.target) + ":" + (x.target.path || ""),
        cell: (x) => policyTargetCell(x.row.original.target, showOwner),
      },
      {
        id: "scope",
        header: "Scope",
        meta: { className: "col-time" },
        accessorFn: (x) => policyScope(x.target).rank,
        cell: (x) => <Badge bg="secondary">{policyScope(x.row.original.target).label}</Badge>,
      },
      {
        id: "defined",
        header: "Defined",
        enableSorting: false,
        cell: (x) => <div className="policy-defined">{this.policySummary(x.row.original)}</div>,
      },
      {
        id: "edit",
        header: "",
        enableSorting: false,
        meta: { className: "col-actions" },
        cell: (x) => (
          <Button
            data-testid="edit-policy"
            as={Link}
            to={policyEditorURL(x.row.original.target)}
            variant="primary"
            size="sm"
          >
            Edit
          </Button>
        ),
      },
    ];

    return (
      <>
        {!this.state.editorTarget && (
          <div className="list-actions">
            <Form onSubmit={this.editPolicyForPath}>
              <Row>
                <Col xs="auto">
                  <Dropdown>
                    <Dropdown.Toggle size="sm" variant="primary" id="dropdown-basic">
                      <FontAwesomeIcon icon={faUserFriends} />
                      &nbsp;{this.state.selectedOwner}
                    </Dropdown.Toggle>

                    <Dropdown.Menu>
                      <Dropdown.Item onClick={() => this.selectOwner(applicablePolicies)}>
                        {applicablePolicies}
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => this.selectOwner(localPolicies)}>{localPolicies}</Dropdown.Item>
                      <Dropdown.Item onClick={() => this.selectOwner(allPolicies)}>{allPolicies}</Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Item onClick={() => this.selectOwner(globalPolicy)}>{globalPolicy}</Dropdown.Item>
                      <Dropdown.Item onClick={() => this.selectOwner(perUserPolicies)}>{perUserPolicies}</Dropdown.Item>
                      <Dropdown.Item onClick={() => this.selectOwner(perHostPolicies)}>{perHostPolicies}</Dropdown.Item>
                      <Dropdown.Divider />
                      {uniqueOwners.map((v) => (
                        <Dropdown.Item key={v} onClick={() => this.selectOwner(v)}>
                          {v}
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  </Dropdown>
                </Col>
                {this.state.selectedOwner === localPolicies ||
                this.state.selectedOwner === this.state.localSourceName ||
                this.state.selectedOwner === applicablePolicies ? (
                  <>
                    <Col>
                      {OptionalDirectory(this, null, "policyPath", {
                        autoFocus: true,
                        placeholder: "enter directory to find or set policy",
                      })}
                    </Col>
                    <Col xs="auto">
                      <Button
                        disabled={!this.state.policyPath}
                        size="sm"
                        type="submit"
                        onClick={this.editPolicyForPath}
                      >
                        Set Policy
                      </Button>
                    </Col>
                  </>
                ) : (
                  <Col />
                )}
              </Row>
            </Form>
          </div>
        )}

        {policies.length > 0 ? (
          <div>
            <p>Found {policies.length} policies matching criteria.</p>
            <KopiaTable data={policies} columns={columns} />
          </div>
        ) : this.state.selectedOwner === localPolicies && this.state.policyPath ? (
          <p>
            No policy found for directory <code>{this.state.policyPath}</code>. Click <b>Set Policy</b> to define it.
          </p>
        ) : (
          <p>No policies found.</p>
        )}
        <CLIEquivalent command="policy list" />
      </>
    );
  }
}

PoliciesInternal.propTypes = {
  navigate: PropTypes.func.isRequired,
};

export function Policies(props) {
  const navigate = useNavigate();

  return <PoliciesInternal navigate={navigate} {...props} />;
}
