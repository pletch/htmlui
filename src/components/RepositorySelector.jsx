import { faCheck, faDatabase, faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { useCallback, useEffect, useState } from "react";
import Dropdown from "react-bootstrap/Dropdown";

/**
 * Chooses the repository the window shows, in KopiaUI, which keeps a
 * server running for every connected repository in one window. Choosing
 * another one reloads the page with it. Outside KopiaUI it shows nothing.
 */
export function RepositorySelector() {
  const [repos, setRepos] = useState(null);
  const [error, setError] = useState(null);
  const supported = !!window.kopiaUI?.listRepositories;

  const load = useCallback(() => {
    if (!supported) {
      return;
    }

    window.kopiaUI
      .listRepositories()
      .then((list) => {
        setRepos(list);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [supported]);

  useEffect(() => {
    load();
  }, [load]);

  if (!supported || !repos) {
    return null;
  }

  const active = repos.find((r) => r.active);
  const name = (r) => r?.description || r?.id || "Repository";

  const choose = (id) => {
    if (id === active?.id) {
      return;
    }

    window.kopiaUI.switchRepository(id).catch((e) => setError(e.message));
  };

  return (
    <Dropdown className="app-repo-selector" onToggle={(open) => open && load()} data-testid="repo-selector">
      <Dropdown.Toggle size="sm" className="app-repo-selector-toggle" title={name(active)}>
        <FontAwesomeIcon icon={faDatabase} className="app-sidebar-icon" />
        <span className="app-repo-selector-name">{name(active)}</span>
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Header>Repositories</Dropdown.Header>
        {repos.map((r) => (
          <Dropdown.Item
            key={r.id}
            active={r.active}
            onClick={() => choose(r.id)}
            title={r.id}
            data-testid={"repo-option-" + r.id}
          >
            <FontAwesomeIcon icon={faCheck} fixedWidth style={{ visibility: r.active ? "visible" : "hidden" }} />{" "}
            {name(r)}
          </Dropdown.Item>
        ))}
        <Dropdown.Divider />
        <Dropdown.Item
          onClick={() => window.kopiaUI.addRepository().catch((e) => setError(e.message))}
          data-testid="repo-add"
        >
          <FontAwesomeIcon icon={faPlus} fixedWidth /> Connect To Another Repository...
        </Dropdown.Item>
        {error && <Dropdown.ItemText className="text-danger small">{error}</Dropdown.ItemText>}
      </Dropdown.Menu>
    </Dropdown>
  );
}
