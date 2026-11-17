import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { RepositorySelector } from "../../src/components/RepositorySelector";

const repos = [
  { id: "repository", description: "Repository in Filesystem: D:\\backup", active: false },
  { id: "repository-2", description: "Repository Server: https://kopia.home:51515", active: true },
];

function mockKopiaUI() {
  window.kopiaUI = {
    listRepositories: vi.fn(() => Promise.resolve(repos)),
    switchRepository: vi.fn(() => Promise.resolve()),
    addRepository: vi.fn(() => Promise.resolve()),
  };
}

afterEach(() => {
  delete window.kopiaUI;
});

describe("RepositorySelector", () => {
  test("shows nothing outside KopiaUI", () => {
    const { container } = render(<RepositorySelector />);
    expect(container).toBeEmptyDOMElement();
  });

  test("shows the repository the window shows", async () => {
    mockKopiaUI();
    render(<RepositorySelector />);

    await waitFor(() =>
      expect(screen.getByTestId("repo-selector")).toHaveTextContent("Repository Server: https://kopia.home:51515"),
    );
  });

  test("switches to another repository", async () => {
    mockKopiaUI();
    render(<RepositorySelector />);

    await waitFor(() => expect(screen.getByTestId("repo-selector")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByTestId("repo-option-repository"));

    expect(window.kopiaUI.switchRepository).toHaveBeenCalledWith("repository");
    // the list is read again when the menu opens
    expect(window.kopiaUI.listRepositories.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("choosing the shown repository does nothing", async () => {
    mockKopiaUI();
    render(<RepositorySelector />);

    await waitFor(() => expect(screen.getByTestId("repo-selector")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByTestId("repo-option-repository-2"));

    expect(window.kopiaUI.switchRepository).not.toHaveBeenCalled();
  });

  test("connects to another repository", async () => {
    mockKopiaUI();
    render(<RepositorySelector />);

    await waitFor(() => expect(screen.getByTestId("repo-selector")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByTestId("repo-add"));

    expect(window.kopiaUI.addRepository).toHaveBeenCalled();
  });

  test("shows why switching failed", async () => {
    mockKopiaUI();
    window.kopiaUI.switchRepository = vi.fn(() => Promise.reject(new Error("unknown repository")));
    render(<RepositorySelector />);

    await waitFor(() => expect(screen.getByTestId("repo-selector")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByTestId("repo-option-repository"));

    expect(await screen.findByText("unknown repository")).toBeInTheDocument();
  });
});
