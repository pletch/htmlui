import React from "react";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { Images, diskDisplayName, taskResultDisplayName } from "../../src/pages/Images";
import { UIPreferencesContext } from "../../src/contexts/UIPreferencesContext";
import { setupAPIMock } from "../testutils/api-mocks";

vi.mock("react-router", async () => {
  const { createRouterMock } = await import("../testutils/react-router-mock.jsx");
  return createRouterMock({ components: { only: true } })();
});

const mockUIPreferences = {
  pageSize: 10,
  theme: "light",
  bytesStringBase2: false,
  defaultSnapshotViewAll: false,
  fontSize: "fs-6",
  setTheme: vi.fn(),
  setPageSize: vi.fn(),
  setByteStringBase: vi.fn(),
  setDefaultSnapshotViewAll: vi.fn(),
  setFontSize: vi.fn(),
};

const createTask = "\\Kopia\\Image create";
const checkTask = "\\Kopia\\Image check";

const image = {
  id: "m1",
  source: { host: "pc", userName: "u", path: "image:disk:0f6ab3f2-1c3d-4e5f-8a9b-0c1d2e3f4a51" },
  description: "",
  startTime: "2026-11-16T02:00:00Z",
  endTime: "2026-11-16T03:00:00Z",
  pins: [],
  rootID: "k1234",
  size: 512000000000,
  diskGuid: "0f6ab3f2-1c3d-4e5f-8a9b-0c1d2e3f4a51",
  volumes: [{ entryName: "p3-C.img", partitionNumber: 3, kind: "ntfs", size: 500000000000 }],
  bytesRead: 200000000000,
  chunksTotal: 100,
  zeroChunks: 10,
  uploadedBytes: 3000000000,
};

function scheduledStatus(overrides = {}) {
  return {
    supported: true,
    tasks: [
      {
        name: createTask,
        scheduled: true,
        status: "Ready",
        nextRunTime: "11/17/2026 2:00:00 AM",
        lastRunTime: "11/16/2026 2:00:00 AM",
        lastResult: "0",
      },
      { name: checkTask, scheduled: false },
    ],
    lastRun: {
      volumes: ["C:"],
      startTime: "2026-11-16T02:00:00Z",
      endTime: "2026-11-16T03:00:00Z",
      success: true,
      images: [
        { source: "u@pc:image:disk:0f6a", snapshotId: "m1", bytesRead: 200000000000, uploadedBytes: 3000000000 },
      ],
    },
    recoveryMedia: { builtAt: "2026-11-01T00:00:00Z", kopiaVersion: "v0.1", target: "usb" },
    ...overrides,
  };
}

let axiosMock;

beforeEach(() => {
  axiosMock = setupAPIMock();
  delete window.kopiaUI;
});

afterEach(() => {
  axiosMock.reset();
  delete window.kopiaUI;
});

const renderImages = () =>
  render(
    <UIPreferencesContext value={mockUIPreferences}>
      <Images />
    </UIPreferencesContext>,
  );

function mockLists(status) {
  axiosMock.onGet("/api/v1/images").reply(200, { images: [image], localHost: "pc", localUsername: "u" });
  axiosMock.onGet("/api/v1/images/status").reply(200, status);
}

describe("Images page", () => {
  test("lists images and the schedule", async () => {
    mockLists(scheduledStatus());
    renderImages();

    await waitFor(() => expect(screen.getByText("Scheduled images")).toBeInTheDocument());

    expect(screen.getByText("Disk 0f6ab3f2-1c3d-4e5f-8a9b-0c1d2e3f4a51")).toBeInTheDocument();
    expect(screen.getByText("p3-C.img")).toBeInTheDocument();
    expect(screen.getByText("3 GB")).toBeInTheDocument();
    expect(screen.getByText(createTask)).toBeInTheDocument();
    expect(screen.getByText("Succeeded", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText(/written to usb/)).toBeInTheDocument();
    expect(screen.getByTestId("run-image-task")).toBeEnabled();

    // the start time links to the snapshot browser
    const links = screen.getAllByTestId("link");
    expect(links.some((l) => l.getAttribute("href") === "/snapshots/dir/k1234")).toBe(true);
  });

  test("tells how to schedule images when no task is installed", async () => {
    mockLists(
      scheduledStatus({
        tasks: [
          { name: createTask, scheduled: false },
          { name: checkTask, scheduled: false },
        ],
        lastRun: undefined,
        recoveryMedia: undefined,
      }),
    );
    renderImages();

    await waitFor(() => expect(screen.getByText(/Images are not scheduled/)).toBeInTheDocument());
    expect(screen.getByText("kopia image schedule install C:")).toBeInTheDocument();
    expect(screen.getByText("No image run has completed yet.")).toBeInTheDocument();
    expect(screen.getByText(/No recovery media was built/)).toBeInTheDocument();
    expect(screen.getByTestId("run-image-task")).toBeDisabled();
  });

  test("shows a failed run and stale recovery media", async () => {
    const st = scheduledStatus();
    st.lastRun = {
      ...st.lastRun,
      success: false,
      error: "unable to create shadow copy",
      recoveryMedia: ["disk 0 changed"],
    };
    mockLists(st);
    renderImages();

    await waitFor(() => expect(screen.getByTestId("last-run-failed")).toBeInTheDocument());
    expect(screen.getByText("unable to create shadow copy")).toBeInTheDocument();
    expect(screen.getByTestId("recovery-media-findings")).toHaveTextContent("disk 0 changed");
  });

  test("on other systems, lists images without a schedule", async () => {
    mockLists({ supported: false, tasks: [] });
    renderImages();

    await waitFor(() => expect(screen.getByText(/Disk images are created on Windows/)).toBeInTheDocument());
    expect(screen.queryByTestId("run-image-task")).not.toBeInTheDocument();
    expect(screen.getByText("p3-C.img")).toBeInTheDocument();
  });

  test("starts the image task", async () => {
    mockLists(scheduledStatus());
    axiosMock.onPost("/api/v1/images/schedule/run").reply(200, { task: createTask });
    renderImages();

    await waitFor(() => expect(screen.getByTestId("run-image-task")).toBeEnabled());
    await userEvent.click(screen.getByTestId("run-image-task"));

    await waitFor(() => expect(screen.getByText(/Started the image task/)).toBeInTheDocument());
    expect(axiosMock.history.post).toHaveLength(1);
  });

  test("asks KopiaUI for administrator rights when the server is denied", async () => {
    mockLists(scheduledStatus());
    axiosMock.onPost("/api/v1/images/schedule/run").reply(403, { code: "ACCESS_DENIED", error: "needs admin" });
    window.kopiaUI = { runImageTaskElevated: vi.fn().mockResolvedValue("started") };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("run-image-task")).toBeEnabled());
    await userEvent.click(screen.getByTestId("run-image-task"));

    await waitFor(() => expect(screen.getByText(/Started the image task/)).toBeInTheDocument());
    expect(window.kopiaUI.runImageTaskElevated).toHaveBeenCalledTimes(1);
  });

  test("reports a declined administrator prompt", async () => {
    mockLists(scheduledStatus());
    axiosMock.onPost("/api/v1/images/schedule/run").reply(403, { code: "ACCESS_DENIED", error: "needs admin" });
    window.kopiaUI = { runImageTaskElevated: vi.fn().mockResolvedValue("canceled") };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("run-image-task")).toBeEnabled());
    await userEvent.click(screen.getByTestId("run-image-task"));

    await waitFor(() => expect(screen.getByText(/administrator prompt was declined/)).toBeInTheDocument());
  });

  test("in a browser, tells how to start the task as administrator", async () => {
    mockLists(scheduledStatus());
    axiosMock.onPost("/api/v1/images/schedule/run").reply(403, { code: "ACCESS_DENIED", error: "needs admin" });
    renderImages();

    await waitFor(() => expect(screen.getByTestId("run-image-task")).toBeEnabled());
    await userEvent.click(screen.getByTestId("run-image-task"));

    await waitFor(() => expect(screen.getByText(/needs administrator rights/)).toBeInTheDocument());
  });

  test("reports other errors starting the task", async () => {
    mockLists(scheduledStatus());
    axiosMock
      .onPost("/api/v1/images/schedule/run")
      .reply(404, { code: "NOT_FOUND", error: "the image task is not scheduled" });
    renderImages();

    await waitFor(() => expect(screen.getByTestId("run-image-task")).toBeEnabled());
    await userEvent.click(screen.getByTestId("run-image-task"));

    await waitFor(() =>
      expect(screen.getByText(/Unable to start the image task: the image task is not scheduled/)).toBeInTheDocument(),
    );
  });

  test("lists the images of every computer", async () => {
    mockLists(scheduledStatus());
    axiosMock
      .onGet("/api/v1/images?all=1")
      .reply(200, { images: [image, { ...image, id: "m2", source: { ...image.source, host: "laptop" } }] });
    renderImages();

    await waitFor(() => expect(screen.getByText("p3-C.img")).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText("All computers"));

    await waitFor(() => expect(screen.getByText("laptop")).toBeInTheDocument());
    expect(screen.getByText("Computer")).toBeInTheDocument();
  });
});

describe("Images helpers", () => {
  test("taskResultDisplayName", () => {
    expect(taskResultDisplayName("0")).toBe("Succeeded");
    expect(taskResultDisplayName("267011")).toBe("Has not run yet");
    expect(taskResultDisplayName("1")).toBe("Failed (0x1)");
    expect(taskResultDisplayName("-2147024891")).toBe("Failed (0x80070005)");
    expect(taskResultDisplayName("")).toBe("");
  });

  test("diskDisplayName", () => {
    expect(diskDisplayName({ path: "image:disk:abc" })).toBe("Disk abc");
    expect(diskDisplayName({ path: "C:\\data" })).toBe("C:\\data");
  });
});
