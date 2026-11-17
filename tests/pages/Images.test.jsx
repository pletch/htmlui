import React from "react";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import {
  Images,
  diskDisplayName,
  progressFraction,
  taskResultDisplayName,
  taskResultVariant,
  taskStateVariant,
} from "../../src/pages/Images";
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
  newDataBytes: 9000000000,
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
        {
          source: "u@pc:image:disk:0f6a",
          snapshotId: "m1",
          bytesRead: 200000000000,
          newDataBytes: 9000000000,
          uploadedBytes: 3000000000,
        },
      ],
    },
    recoveryMedia: { builtAt: "2026-11-01T00:00:00Z", kopiaVersion: "v0.1", target: "usb" },
    schedule: {
      volumes: ["C:"],
      at: "02:00",
      days: ["Monday", "Thursday"],
      wake: true,
      allowOnBattery: false,
      checkDay: "Sunday",
      checkAt: "12:00",
      kopiaVersion: "v0.1.0",
      repository: "NAS",
    },
    scheduleForThisRepository: true,
    kopiaVersion: "v0.1.0",
    ...overrides,
  };
}

function mockDisks() {
  axiosMock.onGet("/api/v1/images/disks").reply(200, {
    supported: true,
    disks: [
      {
        number: 1,
        model: "SATA SSD",
        volumes: [{ letter: "D:", label: "Data", fileSystem: "NTFS", size: 1000000000000 }],
      },
      {
        number: 3,
        model: "NVMe",
        system: true,
        volumes: [{ letter: "C:", label: "Windows", fileSystem: "NTFS", size: 1000000000000 }],
      },
    ],
  });
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
  test("shows 'never' as the last run of a task that has not run", async () => {
    const st = scheduledStatus();
    st.tasks = [
      {
        name: checkTask,
        scheduled: true,
        status: "Ready",
        nextRunTime: "11/22/2026 12:00:00 PM",
        lastRunTime: "11/30/1999 12:00:00 AM",
        lastResult: "267011",
      },
    ];
    mockLists(st);
    renderImages();

    await waitFor(() => expect(screen.getByText("Has not run yet", { selector: "td .badge" })).toBeInTheDocument());
    expect(screen.getByText("never")).toBeInTheDocument();
    expect(screen.queryByText("11/30/1999 12:00:00 AM")).not.toBeInTheDocument();
  });

  test("lists images and the schedule", async () => {
    mockLists(scheduledStatus());
    renderImages();

    await waitFor(() => expect(screen.getByText("Disk images of this computer")).toBeInTheDocument());

    expect(screen.getByText("Disk 0f6ab3f2-1c3d-4e5f-8a9b-0c1d2e3f4a51")).toBeInTheDocument();
    expect(screen.getByText("p3-C.img")).toBeInTheDocument();
    expect(screen.getByText("Disk Size")).toBeInTheDocument();
    expect(screen.getByText("New Data")).toBeInTheDocument();
    expect(screen.getByText("Stored")).toBeInTheDocument();
    expect(screen.getByText("9 GB")).toBeInTheDocument();
    expect(screen.getByText("3 GB")).toBeInTheDocument();
    expect(screen.getByText(/new data 9 GB, stored 3 GB/)).toBeInTheDocument();
    // scheduled tasks: short name over the full path; status and result as pills
    expect(screen.getByText(createTask, { selector: ".source-path" })).toBeInTheDocument();
    expect(screen.getByText("Image create", { selector: ".source-name" })).toBeInTheDocument();
    expect(screen.getByText("Ready", { selector: "td .badge" })).toHaveClass("bg-secondary");
    expect(screen.getByText("Succeeded", { selector: "td .badge" })).toHaveClass("bg-success");
    expect(screen.getByText("not scheduled", { selector: "td .badge" })).toBeInTheDocument();
    expect(screen.getByText(/written to usb/)).toBeInTheDocument();
    expect(screen.getByTestId("run-image-task")).toBeEnabled();

    // the start time links to the snapshot browser
    const links = screen.getAllByTestId("link");
    expect(links.some((l) => l.getAttribute("href") === "/snapshots/dir/k1234")).toBe(true);
  });

  test("offers to set up the schedule when no task is installed", async () => {
    mockLists(
      scheduledStatus({
        tasks: [
          { name: createTask, scheduled: false },
          { name: checkTask, scheduled: false },
        ],
        lastRun: undefined,
        recoveryMedia: undefined,
        schedule: undefined,
      }),
    );
    renderImages();

    await waitFor(() => expect(screen.getByText(/Images are not scheduled/)).toBeInTheDocument());
    expect(screen.getByTestId("edit-schedule")).toHaveTextContent("Set Up Schedule...");
    expect(screen.queryByTestId("remove-schedule")).not.toBeInTheDocument();
    expect(screen.getByText("No image run has completed yet.")).toBeInTheDocument();
    expect(screen.getByText(/No recovery media was built/)).toHaveTextContent("kopia image recovery-media register");
    expect(screen.getByTestId("run-image-task")).toBeEnabled();
  });

  test("shows the schedule settings", async () => {
    mockLists(scheduledStatus());
    window.kopiaUI = { removeImageSchedule: vi.fn() };
    renderImages();

    await waitFor(() =>
      expect(screen.getByTestId("schedule-summary")).toHaveTextContent(
        "Images of the disks holding C:, on Monday, Thursday at 02:00; checked Sundays at 12:00.",
      ),
    );
    expect(screen.getByTestId("edit-schedule")).toHaveTextContent("Change Schedule...");
    expect(screen.getByTestId("remove-schedule")).toBeInTheDocument();
    expect(screen.queryByTestId("schedule-outdated")).not.toBeInTheDocument();
    expect(screen.queryByTestId("schedule-other-repository")).not.toBeInTheDocument();
  });

  test("warns about tasks of another repository", async () => {
    mockLists(scheduledStatus({ scheduleForThisRepository: false }));
    renderImages();

    await waitFor(() => expect(screen.getByTestId("schedule-other-repository")).toHaveTextContent("NAS"));
  });

  test("updates tasks that run an older kopia", async () => {
    const st = scheduledStatus();
    st.schedule = { ...st.schedule, kopiaVersion: "v0.0.9" };
    mockLists(st);
    window.kopiaUI = {
      updateImageSchedule: vi.fn().mockResolvedValue("done"),
      installImageSchedule: vi.fn(),
    };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("schedule-outdated")).toHaveTextContent("v0.0.9"));
    await userEvent.click(screen.getByTestId("update-schedule"));

    await waitFor(() => expect(screen.getByText(/now run this version of kopia/)).toBeInTheDocument());
    expect(window.kopiaUI.updateImageSchedule).toHaveBeenCalledTimes(1);
    expect(window.kopiaUI.installImageSchedule).not.toHaveBeenCalled();
  });

  test("with an older KopiaUI, updates tasks by installing them again", async () => {
    const st = scheduledStatus();
    st.schedule = { ...st.schedule, kopiaVersion: "v0.0.9" };
    mockLists(st);
    window.kopiaUI = { installImageSchedule: vi.fn().mockResolvedValue("done") };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("schedule-outdated")).toHaveTextContent("v0.0.9"));
    await userEvent.click(screen.getByTestId("update-schedule"));

    await waitFor(() => expect(screen.getByText(/now run this version of kopia/)).toBeInTheDocument());
    expect(window.kopiaUI.installImageSchedule).toHaveBeenCalledWith({
      volumes: ["C:"],
      at: "02:00",
      days: ["Monday", "Thursday"],
      checkDay: "Sunday",
      checkAt: "12:00",
      wake: true,
      allowOnBattery: false,
    });
  });

  test("pauses the schedule", async () => {
    mockLists(scheduledStatus());
    window.kopiaUI = { pauseImageSchedule: vi.fn().mockResolvedValue("done"), resumeImageSchedule: vi.fn() };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("pause-schedule")).toHaveTextContent("Pause Schedule"));
    expect(screen.queryByTestId("schedule-paused")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("pause-schedule"));

    await waitFor(() => expect(screen.getByText(/The schedule is paused/)).toBeInTheDocument());
    expect(window.kopiaUI.pauseImageSchedule).toHaveBeenCalledTimes(1);
    expect(window.kopiaUI.resumeImageSchedule).not.toHaveBeenCalled();
  });

  test("resumes a paused schedule, and creates images without its task meanwhile", async () => {
    const st = scheduledStatus();
    st.schedule = { ...st.schedule, paused: true };
    mockLists(st);
    mockDisks();
    window.kopiaUI = {
      pauseImageSchedule: vi.fn(),
      resumeImageSchedule: vi.fn().mockResolvedValue("done"),
      createImageElevated: vi.fn().mockResolvedValue("started"),
    };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("schedule-paused")).toBeInTheDocument());
    expect(screen.getByTestId("schedule-summary")).toHaveTextContent("until the schedule is resumed");

    // a paused task cannot start: the scheduled disks run in a console window
    await userEvent.click(screen.getByTestId("run-image-task"));
    await waitFor(() => expect(screen.getByLabelText(/Disk 3 - NVMe/)).toBeChecked());
    expect(screen.getByTestId("create-image-how")).toHaveTextContent("console window");
    await userEvent.click(screen.getByText("Cancel"));

    expect(screen.getByTestId("pause-schedule")).toHaveTextContent("Resume Schedule");
    await userEvent.click(screen.getByTestId("pause-schedule"));

    await waitFor(() => expect(screen.getByText(/The schedule is resumed/)).toBeInTheDocument());
    expect(window.kopiaUI.resumeImageSchedule).toHaveBeenCalledTimes(1);
    expect(window.kopiaUI.pauseImageSchedule).not.toHaveBeenCalled();
  });

  test("removes the schedule after confirmation", async () => {
    mockLists(scheduledStatus());
    window.kopiaUI = { removeImageSchedule: vi.fn().mockResolvedValue("done") };
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderImages();

    await waitFor(() => expect(screen.getByTestId("remove-schedule")).toBeEnabled());

    // declined
    await userEvent.click(screen.getByTestId("remove-schedule"));
    expect(window.kopiaUI.removeImageSchedule).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("remove-schedule"));
    await waitFor(() => expect(screen.getByText(/tasks are removed/)).toBeInTheDocument());
    expect(window.kopiaUI.removeImageSchedule).toHaveBeenCalledTimes(1);

    confirm.mockRestore();
  });

  test("sets up the schedule in KopiaUI", async () => {
    mockLists(
      scheduledStatus({
        tasks: [
          { name: createTask, scheduled: false },
          { name: checkTask, scheduled: false },
        ],
        schedule: undefined,
      }),
    );
    mockDisks();
    window.kopiaUI = { installImageSchedule: vi.fn().mockResolvedValue("done") };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("edit-schedule")).toBeEnabled());
    await userEvent.click(screen.getByTestId("edit-schedule"));

    // the Windows disk is chosen at first
    await waitFor(() => expect(screen.getByLabelText(/Disk 3 - NVMe/)).toBeChecked());
    expect(screen.getByLabelText(/Disk 1 - SATA SSD/)).not.toBeChecked();

    await userEvent.click(screen.getByLabelText(/Disk 1 - SATA SSD/));

    // every day at first: unticking Sunday leaves the other days
    await userEvent.click(screen.getByLabelText("Sun"));
    await userEvent.selectOptions(screen.getByLabelText("Weekly check"), "none");

    await userEvent.click(screen.getByTestId("save-schedule"));

    await waitFor(() => expect(screen.getByText(/Images are scheduled/)).toBeInTheDocument());
    expect(window.kopiaUI.installImageSchedule).toHaveBeenCalledWith({
      volumes: ["C:", "D:"],
      at: "02:00",
      days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      checkDay: "none",
      checkAt: "12:00",
      wake: true,
      allowOnBattery: false,
    });
  });

  test("keeps the form open when saving fails", async () => {
    mockLists(scheduledStatus());
    mockDisks();
    window.kopiaUI = {
      installImageSchedule: vi.fn().mockRejectedValue(new Error("unable to get the repository password")),
    };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("edit-schedule")).toBeEnabled());
    await userEvent.click(screen.getByTestId("edit-schedule"));
    await waitFor(() => expect(screen.getByLabelText(/Disk 3 - NVMe/)).toBeChecked());
    await userEvent.click(screen.getByTestId("save-schedule"));

    await waitFor(() => expect(screen.getByText("unable to get the repository password")).toBeInTheDocument());
    expect(screen.getByTestId("save-schedule")).toBeInTheDocument();
  });

  test("in a browser, the form shows the command to run", async () => {
    mockLists(scheduledStatus());
    mockDisks();
    renderImages();

    await waitFor(() => expect(screen.getByTestId("edit-schedule")).toBeEnabled());
    await userEvent.click(screen.getByTestId("edit-schedule"));

    await waitFor(() =>
      expect(screen.getByTestId("schedule-command")).toHaveTextContent(
        "kopia image schedule install C: --at 02:00 --days Monday,Thursday --check-day Sunday --check-at 12:00 --wake",
      ),
    );
    expect(screen.queryByTestId("save-schedule")).not.toBeInTheDocument();
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

  test("shows media built on another computer and registered for this one", async () => {
    const st = scheduledStatus();
    st.recoveryMedia = { builtAt: "2026-11-01T00:00:00Z", kopiaVersion: "v0.1", target: "E:\\", builtOn: "DESKTOP" };
    st.lastRun = { ...st.lastRun, recoveryMedia: ["kopia is now v0.2; the media has v0.1"] };
    mockLists(st);
    renderImages();

    await waitFor(() => expect(screen.getByTestId("recovery-media-shared")).toBeInTheDocument());
    expect(screen.getByTestId("recovery-media-shared")).toHaveTextContent("Built on DESKTOP");
    expect(screen.getByTestId("recovery-media-shared")).toHaveTextContent("registered from E:\\");
    expect(screen.getByTestId("recovery-media-shared")).toHaveTextContent("It has the drivers of DESKTOP");
    expect(screen.getByTestId("recovery-media-findings")).toHaveTextContent("on DESKTOP and register it");
  });

  test("on other systems, lists images without a schedule", async () => {
    mockLists({ supported: false, tasks: [] });
    renderImages();

    await waitFor(() => expect(screen.getByText(/Disk images are created on Windows/)).toBeInTheDocument());
    expect(screen.queryByTestId("run-image-task")).not.toBeInTheDocument();
    expect(screen.getByText("p3-C.img")).toBeInTheDocument();
  });

  test("lists the images of every computer", async () => {
    mockLists(scheduledStatus());
    axiosMock
      .onGet("/api/v1/images?all=1")
      .reply(200, { images: [image, { ...image, id: "m2", source: { ...image.source, host: "laptop" } }] });
    renderImages();

    await waitFor(() => expect(screen.getByText("p3-C.img")).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText("All computers"));

    // with images of two computers, each image names its computer
    await waitFor(() => expect(screen.getByText("laptop", { selector: ".source-owner" })).toBeInTheDocument());
    expect(screen.getByText("pc", { selector: ".source-owner" })).toBeInTheDocument();
  });

  test("names the computer only when images of several computers are listed", async () => {
    mockLists(scheduledStatus());
    renderImages();

    await waitFor(() => expect(screen.getByText("p3-C.img", { selector: ".source-path" })).toBeInTheDocument());
    expect(
      screen.getByText("Disk 0f6ab3f2-1c3d-4e5f-8a9b-0c1d2e3f4a51", { selector: ".source-name" }),
    ).toBeInTheDocument();
    expect(document.querySelector(".source-owner")).toBeNull();
    // the start time shows how long the image took (1 hour in the sample)
    expect(screen.getByText(/^took /)).toBeInTheDocument();
  });

  test("shows tasks that Task Scheduler hides as scheduled", async () => {
    const st = scheduledStatus();
    st.tasks = [
      { name: createTask, scheduled: true, statusHidden: true },
      { name: checkTask, scheduled: true, statusHidden: true },
    ];
    mockLists(st);
    renderImages();

    await waitFor(() => expect(screen.getAllByTestId("task-status-hidden")).toHaveLength(2));
    expect(screen.getByTestId("schedule-summary")).toBeInTheDocument();
  });

  test("creates an image without a schedule in KopiaUI", async () => {
    mockLists(
      scheduledStatus({
        tasks: [
          { name: createTask, scheduled: false },
          { name: checkTask, scheduled: false },
        ],
        schedule: undefined,
      }),
    );
    mockDisks();
    window.kopiaUI = { createImageElevated: vi.fn().mockResolvedValue("started") };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("run-image-task")).toBeEnabled());
    await userEvent.click(screen.getByTestId("run-image-task"));

    // the Windows disk is chosen at first
    await waitFor(() => expect(screen.getByLabelText(/Disk 3 - NVMe/)).toBeChecked());
    await userEvent.click(screen.getByTestId("start-image"));

    await waitFor(() => expect(screen.getByText(/in a console window/)).toBeInTheDocument());
    expect(window.kopiaUI.createImageElevated).toHaveBeenCalledWith(["C:"]);
    expect(axiosMock.history.post).toHaveLength(0);
  });

  test("creates an image now with a schedule, without its task", async () => {
    mockLists(scheduledStatus());
    mockDisks();
    window.kopiaUI = {
      createImageElevated: vi.fn().mockResolvedValue("started"),
      runImageTaskElevated: vi.fn(),
    };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("run-image-task")).toBeEnabled());
    await userEvent.click(screen.getByTestId("run-image-task"));

    // the scheduled disk at first; the image runs in a console window anyway
    await waitFor(() => expect(screen.getByLabelText(/Disk 3 - NVMe/)).toBeChecked());
    expect(screen.getByTestId("create-image-how")).toHaveTextContent("console window");
    expect(screen.getByTestId("create-image-how")).toHaveTextContent("A schedule, if any, is not affected");

    await userEvent.click(screen.getByTestId("start-image"));

    await waitFor(() => expect(screen.getByText(/Creating images of the disks holding C:/)).toBeInTheDocument());
    expect(window.kopiaUI.createImageElevated).toHaveBeenCalledWith(["C:"]);
    expect(window.kopiaUI.runImageTaskElevated).not.toHaveBeenCalled();
    expect(axiosMock.history.post).toHaveLength(0);
  });

  test("creates an image of other disks than the schedule's", async () => {
    mockLists(scheduledStatus());
    mockDisks();
    window.kopiaUI = { createImageElevated: vi.fn().mockResolvedValue("started") };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("run-image-task")).toBeEnabled());
    await userEvent.click(screen.getByTestId("run-image-task"));
    await waitFor(() => expect(screen.getByLabelText(/Disk 3 - NVMe/)).toBeChecked());

    await userEvent.click(screen.getByLabelText(/Disk 1 - SATA SSD/));
    await userEvent.click(screen.getByTestId("start-image"));

    await waitFor(() => expect(screen.getByText(/Creating images of the disks holding C: D:/)).toBeInTheDocument());
    expect(window.kopiaUI.createImageElevated).toHaveBeenCalledWith(["C:", "D:"]);
  });

  test("keeps the create dialog open when the prompt is declined", async () => {
    mockLists(scheduledStatus({ tasks: [{ name: createTask, scheduled: false }], schedule: undefined }));
    mockDisks();
    window.kopiaUI = { createImageElevated: vi.fn().mockResolvedValue("canceled") };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("run-image-task")).toBeEnabled());
    await userEvent.click(screen.getByTestId("run-image-task"));
    await waitFor(() => expect(screen.getByLabelText(/Disk 3 - NVMe/)).toBeChecked());
    await userEvent.click(screen.getByTestId("start-image"));

    await waitFor(() => expect(screen.getByText(/no image was created/)).toBeInTheDocument());
    expect(screen.getByTestId("start-image")).toBeInTheDocument();
  });

  test("in a browser, the create dialog shows the command to run", async () => {
    mockLists(scheduledStatus({ tasks: [{ name: createTask, scheduled: false }], schedule: undefined }));
    mockDisks();
    renderImages();

    await waitFor(() => expect(screen.getByTestId("run-image-task")).toBeEnabled());
    await userEvent.click(screen.getByTestId("run-image-task"));

    await waitFor(() => expect(screen.getByTestId("create-image-command")).toHaveTextContent("kopia image create C:"));
    expect(screen.queryByTestId("start-image")).not.toBeInTheDocument();
  });

  test("builds recovery media from the page", async () => {
    mockLists(scheduledStatus({ recoveryMedia: undefined }));
    window.kopiaUI = { createRecoveryMediaElevated: vi.fn().mockResolvedValue("started") };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("create-recovery-media")).toBeEnabled());
    expect(screen.getByText(/No recovery media was built/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("create-recovery-media"));

    await waitFor(() => expect(screen.getByText(/Building recovery media in a console window/)).toBeInTheDocument());
    expect(window.kopiaUI.createRecoveryMediaElevated).toHaveBeenCalledTimes(1);
  });

  test("in a browser, tells how to build recovery media", async () => {
    mockLists(scheduledStatus());
    renderImages();

    await waitFor(() => expect(screen.getByText("kopia image recovery-media create")).toBeInTheDocument());
    expect(screen.queryByTestId("create-recovery-media")).not.toBeInTheDocument();
  });

  const runningProgress = {
    volumes: ["C:"],
    startTime: "2026-11-16T20:00:00Z",
    updatedAt: "2026-11-16T20:10:00Z",
    disk: 1,
    disks: 1,
    diskNumber: 3,
    partition: 3,
    partitions: 4,
    partitionName: "p3-C.img",
    bytesDone: 250000000000,
    bytesTotal: 1000000000000,
    uploadedBytes: 5000000000,
  };

  test("shows the image in progress and stops it", async () => {
    mockLists(scheduledStatus({ progress: runningProgress }));
    window.kopiaUI = { stopImageElevated: vi.fn().mockResolvedValue("done") };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderImages();

    await waitFor(() => expect(screen.getByTestId("image-progress")).toHaveTextContent("partition 3 of 4 (p3-C.img)"));
    expect(screen.getByTestId("image-progress-bar")).toHaveTextContent("25%");
    expect(screen.getByTestId("image-progress-details")).toHaveTextContent("250 GB of 1 TB");
    expect(screen.getByTestId("image-progress-details")).toHaveTextContent("5 GB uploaded");
    // 10 minutes for a quarter: about half an hour left
    expect(screen.getByTestId("image-progress-details")).toHaveTextContent("about 30 minutes left");

    // one image at a time
    expect(screen.getByTestId("run-image-task")).toBeDisabled();

    await userEvent.click(screen.getByTestId("stop-image"));

    await waitFor(() => expect(screen.getByText(/The image is stopping/)).toBeInTheDocument());
    expect(window.kopiaUI.stopImageElevated).toHaveBeenCalledTimes(1);

    confirm.mockRestore();
  });

  test("shows an image that is stopping", async () => {
    mockLists(scheduledStatus({ progress: { ...runningProgress, stopping: true } }));
    window.kopiaUI = { stopImageElevated: vi.fn() };
    renderImages();

    await waitFor(() => expect(screen.getByTestId("stop-image")).toHaveTextContent("Stopping..."));
    expect(screen.getByTestId("stop-image")).toBeDisabled();
  });

  test("in a browser, tells how to stop the image", async () => {
    mockLists(scheduledStatus({ progress: runningProgress }));
    renderImages();

    await waitFor(() => expect(screen.getByText("kopia image stop")).toBeInTheDocument());
    expect(screen.queryByTestId("stop-image")).not.toBeInTheDocument();
  });

  test("shows a stopped run", async () => {
    const st = scheduledStatus();
    st.lastRun = { ...st.lastRun, success: false, stopped: true, error: "stopped by request" };
    mockLists(st);
    renderImages();

    await waitFor(() => expect(screen.getByTestId("last-run-stopped")).toBeInTheDocument());
    expect(screen.queryByTestId("last-run-failed")).not.toBeInTheDocument();
    expect(screen.queryByText("stopped by request")).not.toBeInTheDocument();
  });

  test("tells when an image started from the page did not run", async () => {
    mockLists(
      scheduledStatus({
        lastRequest: {
          id: "r",
          operation: "create",
          time: "2026-11-16T20:00:00Z",
          success: false,
          error: "open repository: invalid password",
        },
      }),
    );
    renderImages();

    await waitFor(() => expect(screen.getByTestId("image-failed-start")).toHaveTextContent("invalid password"));
  });

  test("forgets a failed start once a later image ran", async () => {
    mockLists(
      scheduledStatus({
        lastRequest: { id: "r", operation: "create", time: "2026-11-15T20:00:00Z", success: false, error: "x" },
      }),
    );
    renderImages();

    await waitFor(() => expect(screen.getByTestId("schedule-summary")).toBeInTheDocument());
    expect(screen.queryByTestId("image-failed-start")).not.toBeInTheDocument();
  });
});

describe("Images helpers", () => {
  test("progressFraction", () => {
    expect(progressFraction({ disk: 1, disks: 1, bytesDone: 0, bytesTotal: 0 })).toBe(0);
    expect(progressFraction({ disk: 1, disks: 1, bytesDone: 50, bytesTotal: 100 })).toBe(0.5);
    // the second of two disks, half done
    expect(progressFraction({ disk: 2, disks: 2, bytesDone: 50, bytesTotal: 100 })).toBe(0.75);
    // never past the end
    expect(progressFraction({ disk: 1, disks: 1, bytesDone: 150, bytesTotal: 100 })).toBe(1);
  });

  test("taskResultDisplayName", () => {
    expect(taskResultDisplayName("0")).toBe("Succeeded");
    expect(taskResultDisplayName("267011")).toBe("Has not run yet");
    expect(taskResultDisplayName("1")).toBe("Failed (0x1)");
    expect(taskResultDisplayName("-2147024891")).toBe("Failed (0x80070005)");
    expect(taskResultDisplayName("")).toBe("");
  });

  test("taskResultVariant and taskStateVariant", () => {
    expect(taskResultVariant("0")).toBe("success");
    expect(taskResultVariant("267009")).toBe("primary");
    expect(taskResultVariant("267011")).toBe("secondary");
    expect(taskResultVariant("267014")).toBe("secondary");
    expect(taskResultVariant("1")).toBe("danger");
    expect(taskResultVariant("-2147024891")).toBe("danger");
    expect(taskResultVariant("")).toBeNull();
    expect(taskResultVariant(undefined)).toBeNull();

    expect(taskStateVariant("Running")).toBe("primary");
    expect(taskStateVariant("Disabled")).toBe("warning");
    expect(taskStateVariant("Ready")).toBe("secondary");
  });

  test("diskDisplayName", () => {
    expect(diskDisplayName({ path: "image:disk:abc" })).toBe("Disk abc");
    expect(diskDisplayName({ path: "C:\\data" })).toBe("C:\\data");
  });
});
