import React from "react";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import "@testing-library/jest-dom";
import { FileRetention, folderRetentionPolicies } from "../../src/components/FileRetention";
import { setupAPIMock } from "../testutils/api-mocks";

const policyURL = "/api/v1/policy?userName=u&host=pc&path=";
const resolveURL = "/api/v1/policy/resolve?userName=u&host=pc&path=";

const global = { keepLatest: 10, keepHourly: 48, keepDaily: 7, keepWeekly: 4, keepMonthly: 24, keepAnnual: 3 };

let axiosMock;

beforeEach(() => {
  axiosMock = setupAPIMock();
});

afterEach(() => {
  axiosMock.reset();
});

// resolves like the server does: the computer's own settings over the global ones
function mockResolve() {
  axiosMock.onPost(resolveURL).reply((config) => {
    const own = JSON.parse(config.data).updates.retention || {};
    const effective = {};
    const definition = {};

    for (const [k, v] of Object.entries(global)) {
      effective[k] = own[k] ?? v;
      definition[k] =
        own[k] === undefined ? { host: "", userName: "", path: "" } : { host: "pc", userName: "u", path: "" };
    }

    return [200, { effective: { retention: effective }, definition: { retention: definition } }];
  });
}

function renderRetention() {
  return render(
    <MemoryRouter>
      <FileRetention userName="u" host="pc" />
    </MemoryRouter>,
  );
}

describe("FileRetention", () => {
  test("edits the retention of this computer and says disk images use it", async () => {
    axiosMock.onGet(policyURL).reply(200, { retention: { keepDaily: 14 }, actions: { x: 1 } });
    axiosMock.onGet("/api/v1/policies").reply(200, {
      policies: [
        {
          id: "a",
          target: { userName: "u", host: "pc", path: "C:\\Projects" },
          policy: { retention: { keepLatest: 30 } },
        },
        { id: "b", target: { userName: "u", host: "pc", path: "C:\\Plain" }, policy: { files: {} } },
        {
          id: "c",
          target: { userName: "u", host: "pc", path: "image:disk:1" },
          policy: { retention: { keepLatest: 2 } },
        },
        { id: "d", target: { userName: "v", host: "pc", path: "/other" }, policy: { retention: { keepLatest: 1 } } },
      ],
    });
    axiosMock.onPut(policyURL).reply(200, {});
    mockResolve();

    renderRetention();

    expect(screen.getByTestId("file-retention-note")).toHaveTextContent("Disk images of u@pc use these numbers too");
    expect(within(screen.getByTestId("file-retention-note")).getByRole("link")).toHaveAttribute(
      "href",
      "/images?tab=retention",
    );

    await waitFor(() => expect(screen.getByTestId("retention-input-keepDaily")).toHaveValue("14"));
    await waitFor(() => expect(screen.getByTestId("retention-effective-keepDaily")).toHaveTextContent("this computer"));
    expect(screen.getByTestId("retention-effective-keepLatest")).toHaveTextContent("repository defaults");

    const rows = within(await screen.findByTestId("folder-overrides"))
      .getAllByRole("row")
      .slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("C:\\Projects");
    expect(rows[0]).toHaveTextContent("Latest: 30");

    const user = userEvent.setup();
    await user.type(screen.getByTestId("retention-input-keepWeekly"), "8");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(axiosMock.history.put).toHaveLength(1));
    expect(JSON.parse(axiosMock.history.put[0].data)).toEqual({
      retention: { keepDaily: 14, keepWeekly: 8 },
      actions: { x: 1 },
    });
  });

  test("says when no folder has its own retention", async () => {
    axiosMock.onGet(policyURL).reply(404, { code: "NOT_FOUND", error: "not found" });
    axiosMock.onGet("/api/v1/policies").reply(200, { policies: [] });
    mockResolve();

    renderRetention();

    expect(await screen.findByText(/No folder has its own retention/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("retention-input-keepLatest")).toHaveValue(""));
  });
});

describe("folderRetentionPolicies", () => {
  test("keeps the folders of one user@host that set retention", () => {
    const r = { retention: { keepLatest: 1 } };
    const policies = folderRetentionPolicies(
      [
        { target: { userName: "u", host: "pc", path: "/b" }, policy: r },
        { target: { userName: "u", host: "pc", path: "/a" }, policy: r },
        { target: { userName: "u", host: "pc", path: "" }, policy: r },
        { target: { userName: "u", host: "pc", path: "image:disk:x" }, policy: r },
        { target: { userName: "u", host: "nas", path: "/c" }, policy: r },
        { target: { userName: "u", host: "pc", path: "/d" }, policy: {} },
      ],
      "u",
      "pc",
    );

    expect(policies.map((p) => p.target.path)).toEqual(["/a", "/b"]);
  });
});
