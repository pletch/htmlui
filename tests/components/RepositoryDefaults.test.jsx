import React from "react";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import "@testing-library/jest-dom";
import {
  RepositoryDefaults,
  computerName,
  computerPolicies,
  knownComputers,
  retentionSummary,
} from "../../src/components/RepositoryDefaults";
import { globalSource, inputsFromRetention, retentionCommand } from "../../src/components/RetentionEditor";
import { setupAPIMock } from "../testutils/api-mocks";

const globalURL = "/api/v1/policy?userName=&host=&path=";
const resolveURL = "/api/v1/policy/resolve?userName=&host=&path=";

const builtIn = { keepLatest: 10, keepHourly: 48, keepDaily: 7, keepWeekly: 4, keepMonthly: 24, keepAnnual: 3 };

let axiosMock;

beforeEach(() => {
  axiosMock = setupAPIMock();
});

afterEach(() => {
  axiosMock.reset();
});

// resolves like the server does for the global policy: its own settings over
// the built-in defaults, all of them defined by the global policy
function mockResolve() {
  axiosMock.onPost(resolveURL).reply((config) => {
    const own = JSON.parse(config.data).updates.retention || {};
    const effective = {};
    const definition = {};

    for (const [k, v] of Object.entries(builtIn)) {
      effective[k] = own[k] ?? v;
      definition[k] = { host: "", userName: "", path: "" };
    }

    return [200, { effective: { retention: effective }, definition: { retention: definition } }];
  });
}

function renderDefaults() {
  return render(
    <MemoryRouter>
      <RepositoryDefaults />
    </MemoryRouter>,
  );
}

describe("RepositoryDefaults", () => {
  test("edits the retention of the global policy only", async () => {
    const existing = { retention: { keepLatest: 5, keepDaily: 14 }, compression: { compressorName: "zstd" } };
    axiosMock.onGet(globalURL).reply(200, existing);
    axiosMock.onGet("/api/v1/policies").reply(200, { policies: [] });
    axiosMock.onPut(globalURL).reply(200, {});
    mockResolve();

    renderDefaults();

    await waitFor(() => expect(screen.getByTestId("retention-input-keepLatest")).toHaveValue("5"));
    await waitFor(() => expect(screen.getByTestId("retention-effective-keepLatest")).toHaveTextContent("5"));
    expect(screen.getByTestId("retention-effective-keepLatest")).toHaveTextContent("set here");
    expect(screen.getByTestId("retention-effective-keepHourly")).toHaveTextContent("48");
    expect(screen.getByTestId("retention-effective-keepHourly")).toHaveTextContent("built-in default");

    // the global policy has nothing to inherit from
    expect(screen.queryByRole("button", { name: "Inherit All" })).not.toBeInTheDocument();
    expect(screen.getByText(/No computer has snapshots or settings of its own yet/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.clear(screen.getByTestId("retention-input-keepLatest"));
    await user.type(screen.getByTestId("retention-input-keepLatest"), "3");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(axiosMock.history.put).toHaveLength(1));
    expect(JSON.parse(axiosMock.history.put[0].data)).toEqual({
      retention: { keepLatest: 3, keepDaily: 14 },
      compression: { compressorName: "zstd" },
    });
    await waitFor(() => expect(screen.getByText(/Saved\./)).toBeInTheDocument());
  });

  test("lists every computer, and edits one's retention in place", async () => {
    axiosMock.onGet(globalURL).reply(200, { retention: builtIn });
    mockResolve();
    axiosMock.onGet("/api/v1/sources").reply(200, {
      localUsername: "me",
      localHost: "office",
      sources: [{ source: { userName: "u", host: "pc", path: "/data" } }],
    });
    const pcURL = "/api/v1/policy?userName=u&host=pc&path=";
    axiosMock.onGet(pcURL).reply(200, { retention: { keepDaily: 14 } });
    axiosMock.onPost("/api/v1/policy/resolve?userName=u&host=pc&path=").reply(200, {
      effective: { retention: { keepDaily: 14 } },
      definition: { retention: { keepDaily: { userName: "u", host: "pc", path: "" } } },
    });
    axiosMock.onPut(pcURL).reply(200, {});
    axiosMock.onGet("/api/v1/policies").reply(200, {
      policies: [
        { id: "g", target: { userName: "", host: "", path: "" }, policy: { retention: builtIn } },
        { id: "f", target: { userName: "u", host: "pc", path: "C:\\Data" }, policy: { retention: { keepLatest: 1 } } },
        { id: "n", target: { userName: "", host: "nas", path: "" }, policy: { compression: { compressorName: "s2" } } },
        { id: "u", target: { userName: "u", host: "pc", path: "" }, policy: { retention: { keepDaily: 14 } } },
      ],
    });

    renderDefaults();

    const table = await screen.findByTestId("computer-overrides");
    const rows = within(table).getAllByRole("row").slice(1);

    // this computer, the one with snapshots and the one with only a policy
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("All users on nas");
    expect(rows[0]).toHaveTextContent("repository defaults");
    expect(rows[1]).toHaveTextContent("me@office (this computer)");
    expect(rows[2]).toHaveTextContent("u@pc");
    expect(rows[2]).toHaveTextContent("Daily: 14");
    expect(within(rows[2]).getByRole("link", { name: "All Settings" })).toHaveAttribute(
      "href",
      "/policies/edit?userName=u&host=pc&path=",
    );

    const user = userEvent.setup();
    await user.click(within(rows[2]).getByTestId("computer-edit"));

    const editor = await screen.findByTestId("retention-u@pc");
    await waitFor(() => expect(within(editor).getByTestId("retention-input-keepDaily")).toHaveValue("14"));
    await waitFor(() => expect(within(editor).getByTestId("retention-effective-keepDaily")).toHaveTextContent("u@pc"));

    await user.type(within(editor).getByTestId("retention-input-keepWeekly"), "6");
    await user.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(axiosMock.history.put).toHaveLength(1));
    expect(JSON.parse(axiosMock.history.put[0].data)).toEqual({ retention: { keepDaily: 14, keepWeekly: 6 } });
    // the list is read again, to show what was saved
    await waitFor(() => expect(axiosMock.history.get.filter((r) => r.url === "/api/v1/policies")).toHaveLength(2));
  });

  test("shows why the policies cannot be listed", async () => {
    axiosMock.onGet(globalURL).reply(200, {});
    mockResolve();
    axiosMock.onGet("/api/v1/policies").reply(500, { error: "boom" });

    renderDefaults();

    await waitFor(() => expect(screen.getByText(/Unable to list the policies: boom/)).toBeInTheDocument());
  });
});

describe("repository defaults helpers", () => {
  test("names computers and summarizes retention", () => {
    expect(computerName({ userName: "u", host: "pc" })).toBe("u@pc");
    expect(computerName({ host: "pc" })).toBe("All users on pc");
    expect(retentionSummary({ retention: { keepAnnual: 0, keepLatest: 2 } })).toBe("Latest: 2, Annual: 0");
    expect(retentionSummary({})).toBe("");
  });

  test("knows the computers from snapshots and policies", () => {
    const computers = knownComputers(
      [{ target: { userName: "", host: "nas", path: "" }, policy: { retention: { keepLatest: 1 } } }],
      [{ source: { userName: "u", host: "pc", path: "/a" } }, { source: { userName: "u", host: "pc", path: "/b" } }],
      { userName: "u", host: "pc" },
    );

    expect(computers.map((c) => [c.key, c.local, !!c.policy])).toEqual([
      ["@nas", false, true],
      ["u@pc", true, false],
    ]);
    expect(computers[1].target).toEqual({ userName: "u", host: "pc", path: "" });
  });

  test("keeps only computer and user policies", () => {
    const policies = computerPolicies([
      { target: { host: "b", userName: "x", path: "" } },
      { target: { host: "", userName: "", path: "" } },
      { target: { host: "a", userName: "", path: "" } },
      { target: { host: "b", userName: "x", path: "/home" } },
    ]);

    expect(policies.map((p) => computerName(p.target))).toEqual(["All users on a", "x@b"]);
  });

  test("gives the kopia command for the global policy", () => {
    expect(retentionCommand(globalSource, inputsFromRetention())).toBe("policy show --global");
    expect(retentionCommand(globalSource, inputsFromRetention({ keepLatest: 3 }))).toBe(
      "policy set --global --keep-latest 3",
    );
  });
});
