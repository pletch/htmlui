import React from "react";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { FileSnapshotSettings, allComputers } from "../../src/components/FileSnapshotSettings";
import { setupAPIMock } from "../testutils/api-mocks";

// the policy editor has tests of its own
vi.mock("../../src/components/policy-editor/PolicyEditor", () => ({
  PolicyEditor: ({ userName, host, path, sections }) => (
    <div data-testid="policy-editor">
      {userName}@{host}:{path} {sections.join(",")}
    </div>
  ),
}));

let axiosMock;

beforeEach(() => {
  axiosMock = setupAPIMock();
  axiosMock.onGet("/api/v1/sources").reply(200, {
    localUsername: "me",
    localHost: "office",
    sources: [{ source: { userName: "u", host: "pc", path: "/data" } }],
  });
  axiosMock.onGet("/api/v1/policies").reply(200, {
    policies: [{ target: { userName: "", host: "nas", path: "" }, policy: {} }],
  });
});

afterEach(() => {
  axiosMock.reset();
});

describe("FileSnapshotSettings", () => {
  test("edits this computer's settings at first, and another's when chosen", async () => {
    const onTarget = vi.fn();

    const { rerender } = render(<FileSnapshotSettings sections={["scheduling"]} target={null} onTarget={onTarget} />);

    expect(await screen.findByTestId("policy-editor")).toHaveTextContent("me@office: scheduling");
    expect(screen.getByTestId("file-settings-scope")).toHaveTextContent("file snapshots of me@office only");

    const picker = screen.getByTestId("file-settings-for");
    expect(picker).toHaveValue("me@office");
    expect([...picker.options].map((o) => o.text)).toEqual([
      "All computers",
      "All users on nas",
      "me@office (this computer)",
      "u@pc",
    ]);

    await userEvent.selectOptions(picker, "u@pc");
    expect(onTarget).toHaveBeenCalledWith("u@pc");

    rerender(<FileSnapshotSettings sections={["scheduling"]} target="u@pc" onTarget={onTarget} />);
    expect(screen.getByTestId("policy-editor")).toHaveTextContent("u@pc: scheduling");

    // the settings of all the computers: the global policy
    rerender(<FileSnapshotSettings sections={["scheduling"]} target={allComputers} onTarget={onTarget} />);
    expect(screen.getByTestId("policy-editor")).toHaveTextContent("@: scheduling");
    expect(screen.getByTestId("file-settings-scope")).toHaveTextContent("every computer that uses this repository");
  });

  test("edits the settings of all computers when this computer is not known", async () => {
    axiosMock.onGet("/api/v1/sources").reply(500, { error: "boom" });

    render(<FileSnapshotSettings sections={["files"]} target={null} onTarget={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("file-settings-for")).toHaveValue(allComputers));
    expect(screen.getByTestId("policy-editor")).toHaveTextContent("@: files");
  });
});
