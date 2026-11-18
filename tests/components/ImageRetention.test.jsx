import React from "react";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import {
  DiskRetention,
  ImageRetention,
  definedBy,
  inputsFromRetention,
  retentionCommand,
  retentionFromInputs,
} from "../../src/components/ImageRetention";
import { setupAPIMock } from "../testutils/api-mocks";

const source = { host: "pc", userName: "u", path: "image:disk:0f6ab3f2-1c3d-4e5f-8a9b-0c1d2e3f4a51" };
const policyURL = "/api/v1/policy?userName=u&host=pc&path=" + encodeURIComponent(source.path);
const resolveURL = "/api/v1/policy/resolve?userName=u&host=pc&path=" + encodeURIComponent(source.path);

const global = {};
const thisDisk = { host: "pc", userName: "u", path: source.path };

let axiosMock;

beforeEach(() => {
  axiosMock = setupAPIMock();
});

afterEach(() => {
  axiosMock.reset();
});

// resolves like the server: the disk's own settings over the global ones
function mockResolve() {
  const defaults = { keepLatest: 10, keepHourly: 48, keepDaily: 7, keepWeekly: 4, keepMonthly: 24, keepAnnual: 3 };

  axiosMock.onPost(resolveURL).reply((config) => {
    const own = JSON.parse(config.data).updates.retention || {};
    const effective = {};
    const definition = {};

    for (const [k, v] of Object.entries(defaults)) {
      effective[k] = own[k] ?? v;
      definition[k] = own[k] === undefined ? global : thisDisk;
    }

    return [200, { effective: { retention: effective }, definition: { retention: definition } }];
  });
}

describe("DiskRetention", () => {
  test("shows inherited settings for a disk without a policy", async () => {
    axiosMock.onGet(policyURL).reply(404, { code: "NOT_FOUND", error: "policy not found" });
    mockResolve();

    render(<DiskRetention source={source} title="Disk 0f6ab3f2" />);

    await waitFor(() => expect(screen.getByTestId("retention-effective-keepLatest")).toHaveTextContent("10"));
    expect(screen.getByTestId("retention-input-keepLatest")).toHaveValue("");
    expect(screen.getByTestId("retention-effective-keepLatest")).toHaveTextContent("global policy");
    expect(screen.getByTestId("retention-effective-keepMonthly")).toHaveTextContent("24");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Inherit All" })).toBeDisabled();
  });

  test("saves only the retention of the disk's policy", async () => {
    const existing = { retention: { keepLatest: 5, keepDaily: 2 }, compression: { compressorName: "zstd" } };
    axiosMock.onGet(policyURL).reply(200, existing);
    mockResolve();
    axiosMock.onPut(policyURL).reply(200, {});

    render(<DiskRetention source={source} title="Disk 0f6ab3f2" />);

    await waitFor(() => expect(screen.getByTestId("retention-input-keepLatest")).toHaveValue("5"));
    await waitFor(() => expect(screen.getByTestId("retention-effective-keepLatest")).toHaveTextContent("this disk"));

    const user = userEvent.setup();
    await user.clear(screen.getByTestId("retention-input-keepLatest"));
    await user.type(screen.getByTestId("retention-input-keepLatest"), "3");
    await user.clear(screen.getByTestId("retention-input-keepDaily"));
    await user.type(screen.getByTestId("retention-input-keepWeekly"), "4");

    // the effective values follow the inputs before saving
    await waitFor(() => expect(screen.getByTestId("retention-effective-keepLatest")).toHaveTextContent("3"));
    expect(screen.getByTestId("retention-effective-keepDaily")).toHaveTextContent("global policy");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(axiosMock.history.put).toHaveLength(1));
    expect(JSON.parse(axiosMock.history.put[0].data)).toEqual({
      retention: { keepLatest: 3, keepWeekly: 4 },
      compression: { compressorName: "zstd" },
    });
    await waitFor(() => expect(screen.getByText(/Saved\./)).toBeInTheDocument());
  });

  test("refuses settings that are not whole numbers", async () => {
    axiosMock.onGet(policyURL).reply(404, { code: "NOT_FOUND" });
    mockResolve();

    render(<DiskRetention source={source} title="Disk 0f6ab3f2" />);

    await waitFor(() => expect(screen.getByTestId("retention-input-keepWeekly")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(screen.getByTestId("retention-input-keepWeekly"), "-1");

    expect(screen.getByText(/Weekly must be a whole number/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("shows why the policy cannot be read", async () => {
    axiosMock.onGet(policyURL).reply(500, { code: "INTERNAL", error: "boom" });

    render(<DiskRetention source={source} title="Disk 0f6ab3f2" />);

    await waitFor(() => expect(screen.getByTestId("retention-error")).toHaveTextContent("boom"));
  });
});

describe("ImageRetention", () => {
  test("asks for an image first when there are no disks", () => {
    render(<ImageRetention disks={[]} titleOf={(s) => s.path} />);

    expect(screen.getByText(/once it has an image/)).toBeInTheDocument();
  });
});

describe("retention helpers", () => {
  test("converts between policies and inputs", () => {
    expect(inputsFromRetention({ keepLatest: 3, keepAnnual: 0 })).toEqual({
      keepLatest: "3",
      keepHourly: "",
      keepDaily: "",
      keepWeekly: "",
      keepMonthly: "",
      keepAnnual: "0",
    });

    expect(
      retentionFromInputs({ keepLatest: " 7 ", keepDaily: "" }, { keepDaily: 2, ignoreIdenticalSnapshots: true }),
    ).toEqual({
      keepLatest: 7,
      ignoreIdenticalSnapshots: true,
    });

    expect(() => retentionFromInputs({ keepLatest: "1.5" }, {})).toThrow("Latest must be a whole number");
  });

  test("describes where a setting is defined", () => {
    expect(definedBy(undefined, source)).toBe("");
    expect(definedBy({}, source)).toBe("global policy");
    expect(definedBy({ host: "pc" }, source)).toBe("@pc");
    expect(definedBy({ host: "pc", userName: "u" }, source)).toBe("u@pc");
    expect(definedBy(thisDisk, source)).toBe("this disk");
  });

  test("gives the kopia command", () => {
    expect(retentionCommand(source, inputsFromRetention())).toBe("policy show u@pc:" + source.path);
    expect(retentionCommand(source, inputsFromRetention({ keepLatest: 3, keepMonthly: 6 }))).toBe(
      "policy set u@pc:" + source.path + " --keep-latest 3 --keep-monthly 6",
    );
  });
});
