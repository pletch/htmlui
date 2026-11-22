import { vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { PolicyEditor } from "../../src/components/policy-editor/PolicyEditor";
import { MemoryRouter } from "react-router";
import { setupAPIMock } from "../testutils/api-mocks";
import moment from "moment";
import { fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mockup for the server
let serverMock;
let ref;

// Initialize the server mock before each test
beforeEach(() => {
  serverMock = setupAPIMock();
  ref = React.createRef();
});

it("e2e", async () => {
  const ust1 = "2021-01-01T12:00:00Z";
  const ust2 = "2021-01-01T13:00:00Z";

  // first request from client - will fetch current policy
  serverMock.onGet("/api/v1/policy?userName=some-user&host=some-host&path=some-path").reply(200, {
    retention: {
      keepLatest: 33,
    },
  });

  // second request to resolve the policy.
  serverMock
    .onPost("/api/v1/policy/resolve?userName=some-user&host=some-host&path=some-path", {
      updates: {
        retention: {
          keepLatest: 33,
        },
      },
      numUpcomingSnapshotTimes: 5,
    })
    .reply(200, {
      effective: {
        retention: {
          keepLatest: 33,
          keepHourly: 45,
        },
      },
      definition: {
        retention: {
          keepLatest: { host: "h1", userName: "some-user", path: "some-path" },
          keepMonthly: { host: "h1", userName: "u1", path: "p1" },
        },
      },
      upcomingSnapshotTimes: [ust1, ust2],
    });

  // second request to resolve the policy.
  serverMock
    .onPost("/api/v1/policy/resolve?userName=some-user&host=some-host&path=some-path", {
      updates: {
        retention: {
          keepLatest: 44,
        },
      },
      numUpcomingSnapshotTimes: 5,
    })
    .reply(200, {
      effective: {
        retention: {
          keepLatest: 44,
          keepHourly: 45,
        },
      },
      definition: {
        retention: {
          keepLatest: {
            host: "some-host",
            userName: "some-user",
            path: "some-path",
          },
          keepMonthly: { host: "h1", userName: "u1", path: "p1" },
        },
      },
      upcomingSnapshotTimes: [ust1, ust2],
    });

  // request to save updated policy.
  serverMock
    .onPut("/api/v1/policy?userName=some-user&host=some-host&path=some-path", {
      retention: {
        keepLatest: 44,
      },
    })
    .reply(200, {
      effective: {
        retention: {
          keepLatest: 33,
          keepHourly: 45,
        },
      },
      definition: {
        retention: {
          keepLatest: { host: "h1", userName: "some-user", path: "some-path" },
          keepMonthly: { host: "h1", userName: "u1", path: "p1" },
        },
      },
      upcomingSnapshotTimes: [ust1, ust2],
    });

  let closeCalled = 0;

  function closeFunc() {
    closeCalled++;
  }

  const { getByTestId } = render(
    <MemoryRouter>
      <PolicyEditor ref={ref} host="some-host" userName="some-user" path="some-path" close={closeFunc} />
    </MemoryRouter>,
  );

  await waitFor(() => expect(getByTestId("effective-retention.keepHourly").value).toBe("45"));
  expect(getByTestId("effective-retention.keepLatest").value).toEqual("33");

  await waitFor(() =>
    expect(getByTestId("definition-retention.keepLatest").innerHTML).toContain(`Directory: some-user@h1:some-path`),
  );
  await waitFor(() =>
    expect(getByTestId("definition-retention.keepMonthly").innerHTML).toContain("Directory: u1@h1:p1"),
  );

  const expectedUpcomingSnapshotTimes = [
    `<li>${moment(ust1).format("L LT")} (${moment(ust1).fromNow()})</li>`,
    `<li>${moment(ust2).format("L LT")} (${moment(ust2).fromNow()})</li>`,
  ].join("");

  await waitFor(() => expect(getByTestId("upcoming-snapshot-times").innerHTML).toEqual(expectedUpcomingSnapshotTimes));

  // change a field
  fireEvent.change(getByTestId("control-policy.retention.keepLatest"), { target: { value: "44" } });

  // this will trigger resolve and will update effective field: "(Defined by this policy)"
  await waitFor(() => expect(getByTestId("effective-retention.keepLatest").value).toBe("44"));
  await waitFor(() =>
    expect(getByTestId("definition-retention.keepLatest").innerHTML).toEqual("(Defined by this policy)"),
  );

  fireEvent.click(getByTestId("button-save"));
  await waitFor(() => expect(serverMock.history.put.length).toEqual(1));
  await waitFor(() => expect(closeCalled).toEqual(1));
});

it("shows only the given sections and stays open after saving", async () => {
  const globalURL = "/api/v1/policy?userName=&host=&path=";

  serverMock.onGet(globalURL).reply(200, { retention: { keepLatest: 10 }, scheduling: { intervalSeconds: 3600 } });
  serverMock.onPost(/\/api\/v1\/policy\/resolve/).reply(200, { effective: {}, definition: {} });
  serverMock.onPut(globalURL).reply(200, {});

  const { findByText, getByTestId, queryByText, getAllByRole } = render(
    <MemoryRouter>
      <PolicyEditor host="" userName="" path="" sections={["scheduling", "files"]} />
    </MemoryRouter>,
  );

  await findByText("Scheduling");

  // in the order given, without the others
  const headers = getAllByRole("button")
    .map((b) => b.textContent.trim())
    .filter((t) => ["Scheduling", "Files", "Compression", "Snapshot Retention"].includes(t));
  expect(headers).toEqual(["Scheduling", "Files"]);
  expect(queryByText("Delete Policy")).toBeNull();

  fireEvent.click(getByTestId("button-save"));

  await waitFor(() => expect(serverMock.history.put.length).toEqual(1));
  expect(JSON.parse(serverMock.history.put[0].data)).toEqual({
    retention: { keepLatest: 10 },
    scheduling: { intervalSeconds: 3600 },
  });
  await waitFor(() => expect(getByTestId("policy-saved")).toHaveTextContent("Saved."));
});

it("saves and deletes a folder policy in place", async () => {
  const folderURL = "/api/v1/policy?userName=u&host=h&path=%2Fdata";
  let exists = false;

  serverMock.onGet(folderURL).reply(() => (exists ? [200, { retention: {} }] : [404, { code: "NOT_FOUND" }]));
  serverMock.onPost(/\/api\/v1\/policy\/resolve/).reply(200, { effective: {}, definition: {} });
  serverMock.onPut(folderURL).reply(() => {
    exists = true;
    return [200, {}];
  });
  serverMock.onDelete(folderURL).reply(() => {
    exists = false;
    return [200, {}];
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

  const { findByText, getByTestId, queryByText } = render(
    <MemoryRouter>
      <PolicyEditor host="h" userName="u" path="/data" />
    </MemoryRouter>,
  );

  await findByText("Scheduling");
  // a new policy has nothing to delete
  expect(queryByText("Delete Policy")).toBeNull();

  fireEvent.click(getByTestId("button-save"));
  await waitFor(() => expect(getByTestId("policy-saved")).toHaveTextContent("Saved."));

  fireEvent.click(await findByText("Delete Policy"));

  await waitFor(() => expect(serverMock.history.delete.length).toEqual(1));
  await waitFor(() => expect(queryByText("Delete Policy")).toBeNull());
  confirm.mockRestore();
});
