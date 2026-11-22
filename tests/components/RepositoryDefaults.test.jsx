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
    expect(screen.getByText(/No computer has its own settings/)).toBeInTheDocument();

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

  test("lists the computers with their own settings", async () => {
    axiosMock.onGet(globalURL).reply(200, { retention: builtIn });
    mockResolve();
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

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("All users on nas");
    expect(rows[0]).toHaveTextContent("defaults");
    expect(rows[1]).toHaveTextContent("u@pc");
    expect(rows[1]).toHaveTextContent("Daily: 14");
    expect(within(rows[1]).getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/policies/edit?userName=u&host=pc&path=",
    );
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
