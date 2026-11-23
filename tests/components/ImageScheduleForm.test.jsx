import { describe, test, expect } from "vitest";
import {
  diskScheduleOf,
  installedScheduleGroups,
  perDiskSchedules,
  scheduleCommand,
  scheduleSummary,
  settingsFromSchedule,
  withDiskSchedules,
} from "../../src/components/ImageScheduleForm";

const shared = { checkDay: "Sunday", checkAt: "12:00", wake: true, allowOnBattery: false };

describe("image schedule helpers", () => {
  test("reads the settings of one schedule for all disks, as kopia wrote them before", () => {
    const old = { volumes: ["C:", "D:"], at: "02:00", days: ["Monday"], ...shared };

    expect(installedScheduleGroups(old)).toEqual([{ volumes: ["C:", "D:"], at: "02:00", days: ["Monday"] }]);
    expect(settingsFromSchedule(old)).toEqual({ volumes: ["C:", "D:"], at: "02:00", days: ["Monday"], ...shared });
  });

  test("reads the schedule of each disk", () => {
    const s = {
      volumes: ["C:", "D:"],
      at: "02:00",
      disks: [
        { volumes: ["C:"], at: "02:00", task: "Image create" },
        { volumes: ["D:"], at: "21:30", days: ["Sunday"], task: "Image create 2" },
      ],
      ...shared,
    };

    expect(settingsFromSchedule(s)).toEqual({
      volumes: ["C:"],
      at: "02:00",
      days: [],
      disks: [{ volumes: ["D:"], at: "21:30", days: ["Sunday"] }],
      ...shared,
    });
    expect(diskScheduleOf(s, ["D:"])).toEqual({ volumes: ["D:"], at: "21:30", days: ["Sunday"] });
    expect(diskScheduleOf(s, ["E:"])).toBeUndefined();
    expect(diskScheduleOf(undefined, ["C:"])).toBeUndefined();
  });

  test("groups disks imaged at the same time on the same days", () => {
    const perDisk = [
      { volume: "C:", at: "02:00", days: [] },
      { volume: "D:", at: "21:30", days: ["Thursday", "Monday"] },
      { volume: "E:", at: "02:00", days: [] },
      { volume: "F:", at: "21:30", days: ["Monday", "Thursday"] },
    ];

    const s = withDiskSchedules({ ...shared, at: "02:00", days: [], volumes: [] }, perDisk);

    expect(s).toEqual({
      volumes: ["C:", "E:"],
      at: "02:00",
      days: [],
      disks: [{ volumes: ["D:", "F:"], at: "21:30", days: ["Monday", "Thursday"] }],
      ...shared,
    });
    expect(perDiskSchedules(s).map((d) => d.volume)).toEqual(["C:", "E:", "D:", "F:"]);

    // one schedule for all: no disks, as KopiaUI has always sent it
    const one = withDiskSchedules(s, [{ volume: "C:", at: "03:00", days: [] }]);
    expect(one).toEqual({ volumes: ["C:"], at: "03:00", days: [], ...shared });
  });

  test("gives the command and the summary of per-disk schedules", () => {
    const s = {
      volumes: ["C:"],
      at: "02:00",
      days: [],
      disks: [{ volumes: ["D:", "E:"], at: "21:30", days: ["Monday", "Thursday"] }],
      ...shared,
    };

    expect(scheduleCommand(s)).toBe(
      "kopia image schedule install C: --at 02:00 --disk-schedule D:,E:=21:30/Monday,Thursday --check-day Sunday --check-at 12:00 --wake",
    );
    expect(scheduleSummary(s)).toBe(
      "Images of the disks holding C:, every day at 02:00; of D: E:, on Monday, Thursday at 21:30; checked Sundays at 12:00.",
    );
  });
});
