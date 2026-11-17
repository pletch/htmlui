import React from "react";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router";
import { Policies, PoliciesInternal, policyScope } from "../../src/pages/Policies";
import { AppContext } from "../../src/contexts/AppContext";
import { UIPreferencesContext } from "../../src/contexts/UIPreferencesContext";
import { setupAPIMock } from "../testutils/api-mocks";
import { policyEditorURL } from "../../src/utils/policyutil";
import "@testing-library/jest-dom";
import { mockNavigate, resetRouterMocks } from "../testutils/react-router-mock.jsx";

let axiosMock;

// Mock react-router using unified helper
vi.mock("react-router", async () => {
  const { createRouterMock } = await import("../testutils/react-router-mock.jsx");
  return createRouterMock()();
});

// Mock context values
const mockAppContextValue = {
  repositoryUpdated: vi.fn(),
  repositoryDescriptionUpdated: vi.fn(),
  repoDescription: "Test Repository",
};

const mockUIPreferencesContext = {
  pageSize: 10,
  setPageSize: vi.fn(),
  theme: "light",
  bytesStringBase2: false,
  defaultSnapshotViewAll: false,
  fontSize: "fs-6",
  setTheme: vi.fn(),
  setByteStringBase: vi.fn(),
  setDefaultSnapshotViewAll: vi.fn(),
  setFontSize: vi.fn(),
};

// Sample test data
const samplePolicies = [
  {
    target: { userName: "testuser", host: "testhost", path: "/home/testuser" },
    policy: {
      retention: { keepLatest: 10 },
      scheduling: { interval: "1h" },
    },
  },
  {
    target: { userName: "testuser", host: "testhost", path: "/documents" },
    policy: {
      retention: { keepLatest: 5 },
    },
  },
  {
    target: { userName: "", host: "testhost", path: "" },
    policy: {
      retention: { keepLatest: 20 },
    },
  },
  {
    target: { userName: "", host: "", path: "" },
    policy: {
      retention: { keepLatest: 30 },
      scheduling: { interval: "24h" },
    },
  },
];

const sampleSources = [
  {
    source: { userName: "testuser", host: "testhost", path: "/home/testuser" },
  },
  {
    source: { userName: "otheruser", host: "otherhost", path: "/home/otheruser" },
  },
];

// Helper function to render with all providers
const renderWithProviders = (
  component,
  appContextValue = mockAppContextValue,
  uiPrefsValue = mockUIPreferencesContext,
) => {
  return render(
    <BrowserRouter>
      <AppContext.Provider value={appContextValue}>
        <UIPreferencesContext.Provider value={uiPrefsValue}>{component}</UIPreferencesContext.Provider>
      </AppContext.Provider>
    </BrowserRouter>,
  );
};

/**
 * Setup API mocks before each test
 */
beforeEach(() => {
  axiosMock = setupAPIMock();
  resetRouterMocks();
  vi.clearAllMocks();
  mockNavigate.mockClear();
});

/**
 * Clean up after each test
 */
afterEach(() => {
  axiosMock.reset();
});

describe("Policies component - loading state", () => {
  test("shows loading state initially", () => {
    // Mock delayed responses
    axiosMock.onGet("/api/v1/policies").reply(() => {
      return new Promise(() => {
        // Never resolve to keep loading state
      });
    });
    axiosMock.onGet("/api/v1/sources").reply(() => {
      return new Promise(() => {
        // Never resolve to keep loading state
      });
    });

    renderWithProviders(<Policies />);
    expect(screen.getByText("Loading ...")).toBeInTheDocument();
  });

  test("handles API error gracefully", async () => {
    axiosMock.onGet("/api/v1/policies").reply(500, { message: "Server error" });
    axiosMock.onGet("/api/v1/sources").reply(200, {
      localUsername: "testuser",
      localHost: "testhost",
      multiUser: false,
      sources: sampleSources,
    });

    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("Request failed with status code 500")).toBeInTheDocument();
    });
  });
});

describe("Policies component - loaded state", () => {
  beforeEach(() => {
    axiosMock.onGet("/api/v1/policies").reply(200, { policies: samplePolicies });
    axiosMock.onGet("/api/v1/sources").reply(200, {
      localUsername: "testuser",
      localHost: "testhost",
      multiUser: false,
      sources: sampleSources,
    });
  });

  test("displays policies table with correct headers", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("Found 4 policies matching criteria.")).toBeInTheDocument();
    });

    // Check table headers
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Applies To", "Scope", "Defined", ""]);
  });

  test("describes each policy target with its scope", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("Found 4 policies matching criteria.")).toBeInTheDocument();
    });

    // Global policy
    expect(screen.getByText("Global policy", { selector: ".source-name" })).toBeInTheDocument();
    expect(screen.getByText("Every user, host and folder")).toBeInTheDocument();
    expect(screen.getByText("Global", { selector: ".badge" })).toBeInTheDocument();

    // Per-host policy
    expect(screen.getByText("testhost", { selector: ".source-name" })).toBeInTheDocument();
    expect(screen.getByText("Every user on this host")).toBeInTheDocument();
    expect(screen.getByText("Host", { selector: ".badge" })).toBeInTheDocument();

    // Folder policies: folder name over the full path; one owner, so no owner line
    expect(screen.getByText("testuser", { selector: ".source-name" })).toBeInTheDocument();
    expect(screen.getByText("/home/testuser", { selector: ".source-path" })).toBeInTheDocument();
    expect(screen.getByText("documents", { selector: ".source-name" })).toBeInTheDocument();
    expect(screen.getAllByText("Folder", { selector: ".badge" })).toHaveLength(2);
    expect(document.querySelector(".source-owner")).toBeNull();
  });

  test("displays CLI equivalent component", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByTestId("show-cli-button")).toBeInTheDocument();
    });
  });

  test("shows page size dropdown from KopiaTable", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("Page Size: 10")).toBeInTheDocument();
    });
  });
});

describe("Policies component - owners of folder policies", () => {
  test("shows the owner under the path when several owners are listed", async () => {
    const policies = [
      ...samplePolicies,
      { target: { userName: "other", host: "otherhost", path: "/data" }, policy: { retention: { keepLatest: 1 } } },
      { target: { userName: "other", host: "otherhost", path: "" }, policy: { retention: { keepLatest: 1 } } },
    ];
    axiosMock.onGet("/api/v1/policies").reply(200, { policies });
    axiosMock.onGet("/api/v1/sources").reply(200, {
      localUsername: "testuser",
      localHost: "testhost",
      multiUser: false,
      sources: sampleSources,
    });

    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("Found 4 policies matching criteria.")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Applicable Policies/ }));
    await userEvent.click(screen.getByText("All Policies"));

    await waitFor(() => {
      expect(screen.getByText("Found 6 policies matching criteria.")).toBeInTheDocument();
    });

    // Folder policies get an owner line; the per-user policy shows its owner as the name.
    expect(screen.getByText("other@otherhost", { selector: ".source-owner" })).toBeInTheDocument();
    expect(screen.getAllByText("testuser@testhost", { selector: ".source-owner" })).toHaveLength(2);
    expect(screen.getByText("other@otherhost", { selector: ".source-name" })).toBeInTheDocument();
    expect(screen.getByText("Every folder of this user")).toBeInTheDocument();
  });
});

describe("policyScope", () => {
  test.each([
    [{ userName: "", host: "", path: "" }, 0, "Global"],
    [{ userName: null, host: "h", path: null }, 1, "Host"],
    [{ userName: "u", host: "h", path: "" }, 2, "User"],
    [{ userName: "u", host: "h", path: "/p" }, 3, "Folder"],
  ])("%j is %i %s", (target, rank, label) => {
    expect(policyScope(target)).toEqual({ rank, label });
  });
});

describe("Policies component - policy filtering", () => {
  beforeEach(() => {
    axiosMock.onGet("/api/v1/policies").reply(200, { policies: samplePolicies });
    axiosMock.onGet("/api/v1/sources").reply(200, {
      localUsername: "testuser",
      localHost: "testhost",
      multiUser: false,
      sources: sampleSources,
    });
  });

  test("filters policies by 'Applicable Policies' by default", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      // Should show applicable policies (local user + local host + global)
      expect(screen.getByText("Found 4 policies matching criteria.")).toBeInTheDocument();
      expect(screen.getByText("Applicable Policies")).toBeInTheDocument();
    });
  });

  test("filters to show only global policy", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("Found 4 policies matching criteria.")).toBeInTheDocument();
    });

    // Click dropdown and select Global Policy
    const dropdown = screen.getByRole("button", { name: /Applicable Policies/ });
    await userEvent.click(dropdown);

    const globalPolicyOption = screen.getByText("Global Policy");
    await userEvent.click(globalPolicyOption);

    await waitFor(() => {
      expect(screen.getByText("Found 1 policies matching criteria.")).toBeInTheDocument();
    });
  });

  test("filters to show all policies", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("Found 4 policies matching criteria.")).toBeInTheDocument();
    });

    // Click dropdown and select All Policies
    const dropdown = screen.getByRole("button", { name: /Applicable Policies/ });
    await userEvent.click(dropdown);

    const allPoliciesOption = screen.getByText("All Policies");
    await userEvent.click(allPoliciesOption);

    await waitFor(() => {
      expect(screen.getByText("Found 4 policies matching criteria.")).toBeInTheDocument();
    });
  });

  test("filters to show per-user policies", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("Found 4 policies matching criteria.")).toBeInTheDocument();
    });

    // Click dropdown and select Per-User Policies
    const dropdown = screen.getByRole("button", { name: /Applicable Policies/ });
    await userEvent.click(dropdown);

    const perUserPoliciesOption = screen.getByText("Per-User Policies");
    await userEvent.click(perUserPoliciesOption);

    await waitFor(() => {
      expect(screen.getByText("No policies found.")).toBeInTheDocument();
    });
  });

  test("filters to show per-host policies", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("Found 4 policies matching criteria.")).toBeInTheDocument();
    });

    // Click dropdown and select Per-Host Policies
    const dropdown = screen.getByRole("button", { name: /Applicable Policies/ });
    await userEvent.click(dropdown);

    const perHostPoliciesOption = screen.getByText("Per-Host Policies");
    await userEvent.click(perHostPoliciesOption);

    await waitFor(() => {
      expect(screen.getByText("Found 1 policies matching criteria.")).toBeInTheDocument();
    });
  });
});

describe("Policies component - policy path input", () => {
  beforeEach(() => {
    axiosMock.onGet("/api/v1/policies").reply(200, { policies: samplePolicies });
    axiosMock.onGet("/api/v1/sources").reply(200, {
      localUsername: "testuser",
      localHost: "testhost",
      multiUser: false,
      sources: sampleSources,
    });
  });

  test("shows policy path input for applicable policies", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      const pathInput = screen.getByPlaceholderText("enter directory to find or set policy");
      expect(pathInput).toBeInTheDocument();

      const setPolicyButton = screen.getByRole("button", { name: "Set Policy" });
      expect(setPolicyButton).toBeInTheDocument();
      expect(setPolicyButton).toBeDisabled();
    });
  });

  test("enables set policy button when path is entered", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      const pathInput = screen.getByPlaceholderText("enter directory to find or set policy");
      expect(pathInput).toBeInTheDocument();
    });

    const pathInput = screen.getByPlaceholderText("enter directory to find or set policy");
    const setPolicyButton = screen.getByRole("button", { name: "Set Policy" });

    await userEvent.type(pathInput, "/some/path");

    await waitFor(() => {
      expect(setPolicyButton).not.toBeDisabled();
    });
  });

  test("navigates to policy editor when set policy is clicked with valid path", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      const pathInput = screen.getByPlaceholderText("enter directory to find or set policy");
      expect(pathInput).toBeInTheDocument();
    });

    const pathInput = screen.getByPlaceholderText("enter directory to find or set policy");
    const setPolicyButton = screen.getByRole("button", { name: "Set Policy" });

    await userEvent.type(pathInput, "/some/absolute/path");
    await userEvent.click(setPolicyButton);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        "/policies/edit?userName=testuser&host=testhost&path=%2Fsome%2Fabsolute%2Fpath",
      );
    });
  });

  test("shows alert for invalid policy path", async () => {
    // Mock alert
    const alertMock = vi.fn();
    const originalAlert = window.alert;
    window.alert = alertMock;

    renderWithProviders(<Policies />);

    await waitFor(() => {
      const pathInput = screen.getByPlaceholderText("enter directory to find or set policy");
      expect(pathInput).toBeInTheDocument();
    });

    const pathInput = screen.getByPlaceholderText("enter directory to find or set policy");
    const setPolicyButton = screen.getByRole("button", { name: "Set Policy" });

    await userEvent.type(pathInput, "relative/path");
    await userEvent.click(setPolicyButton);

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("Policies can not be defined for relative paths"));
    });

    // Restore alert
    window.alert = originalAlert;
  });

  test("hides policy path input for non-applicable policy types", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("enter directory to find or set policy")).toBeInTheDocument();
    });

    // Switch to "All Policies"
    const dropdown = screen.getByRole("button", { name: /Applicable Policies/ });
    await userEvent.click(dropdown);

    const allPoliciesOption = screen.getByText("All Policies");
    await userEvent.click(allPoliciesOption);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("enter directory to find or set policy")).not.toBeInTheDocument();
    });
  });
});

describe("Policies component - sync functionality", () => {
  beforeEach(() => {
    axiosMock.onGet("/api/v1/policies").reply(200, { policies: samplePolicies });
    axiosMock.onGet("/api/v1/sources").reply(200, {
      localUsername: "testuser",
      localHost: "testhost",
      multiUser: false,
      sources: sampleSources,
    });
    axiosMock.onPost("/api/v1/repo/sync").reply(200, {});
  });

  test("sync method calls API endpoints", async () => {
    const component = new PoliciesInternal();
    component.state = {
      policies: [],
      isLoading: false,
      error: null,
      editorTarget: null,
      selectedOwner: "Applicable Policies",
      policyPath: "",
      sources: [],
    };

    // Mock the fetchPolicies and fetchSourcesWithoutSpinner methods
    component.fetchPolicies = vi.fn();
    component.fetchSourcesWithoutSpinner = vi.fn();

    component.sync();

    expect(component.fetchPolicies).toHaveBeenCalled();

    await waitFor(() => {
      expect(component.fetchSourcesWithoutSpinner).toHaveBeenCalled();
    });
  });
});

describe("Policies component - no policies state", () => {
  test("shows no policies message when no policies exist", async () => {
    axiosMock.onGet("/api/v1/policies").reply(200, { policies: [] });
    axiosMock.onGet("/api/v1/sources").reply(200, {
      localUsername: "testuser",
      localHost: "testhost",
      multiUser: false,
      sources: sampleSources,
    });

    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("No policies found.")).toBeInTheDocument();
    });
  });

  test("shows specific message for local policies with path", async () => {
    axiosMock.onGet("/api/v1/policies").reply(200, { policies: [] });
    axiosMock.onGet("/api/v1/sources").reply(200, {
      localUsername: "testuser",
      localHost: "testhost",
      multiUser: false,
      sources: sampleSources,
    });

    renderWithProviders(<Policies />);

    await waitFor(() => {
      const pathInput = screen.getByPlaceholderText("enter directory to find or set policy");
      expect(pathInput).toBeInTheDocument();
    });

    // Switch to Local Path Policies
    const dropdown = screen.getByRole("button", { name: /Applicable Policies/ });
    await userEvent.click(dropdown);

    const localPoliciesOption = screen.getByText("Local Path Policies");
    await userEvent.click(localPoliciesOption);

    // Enter a path
    const pathInput = screen.getByPlaceholderText("enter directory to find or set policy");
    await userEvent.type(pathInput, "/some/path");

    await waitFor(() => {
      expect(screen.getByText(/No policy found for directory/)).toBeInTheDocument();
      // Check for the bold text within the message, not the button
      expect(screen.getByRole("button", { name: "Set Policy" })).toBeInTheDocument();
    });
  });
});

describe("PoliciesInternal component - utility methods", () => {
  let component;

  beforeEach(() => {
    component = new PoliciesInternal();
    component.state = {
      localHost: "testhost",
      localSourceName: "testuser@testhost",
    };
  });

  test("isGlobalPolicy identifies global policies correctly", () => {
    expect(component.isGlobalPolicy({ target: { userName: "", host: "", path: "" } })).toBe(true);
    expect(component.isGlobalPolicy({ target: { userName: null, host: null, path: null } })).toBe(true);
    expect(component.isGlobalPolicy({ target: { userName: "user", host: "", path: "" } })).toBe(false);
    expect(component.isGlobalPolicy({ target: { userName: "", host: "host", path: "" } })).toBe(false);
  });

  test("isLocalHostPolicy identifies local host policies correctly", () => {
    expect(component.isLocalHostPolicy({ target: { userName: "", host: "testhost", path: "" } })).toBe(true);
    expect(component.isLocalHostPolicy({ target: { userName: null, host: "testhost", path: null } })).toBe(true);
    expect(component.isLocalHostPolicy({ target: { userName: "", host: "otherhost", path: "" } })).toBe(false);
    expect(component.isLocalHostPolicy({ target: { userName: "user", host: "testhost", path: "" } })).toBe(false);
    expect(component.isLocalHostPolicy({ target: { userName: "", host: "testhost", path: "/path" } })).toBe(false);
  });

  test("isLocalUserPolicy identifies local user policies correctly", () => {
    expect(component.isLocalUserPolicy({ target: { userName: "testuser", host: "testhost" } })).toBe(true);
    expect(component.isLocalUserPolicy({ target: { userName: "otheruser", host: "otherhost" } })).toBe(false);
  });

  test("selectOwner updates selectedOwner state", () => {
    component.setState = vi.fn();
    component.selectOwner("New Owner");
    expect(component.setState).toHaveBeenCalledWith({ selectedOwner: "New Owner" });
  });
});

describe("Policies component - policy summary", () => {
  beforeEach(() => {
    axiosMock.onGet("/api/v1/policies").reply(200, { policies: samplePolicies });
    axiosMock.onGet("/api/v1/sources").reply(200, {
      localUsername: "testuser",
      localHost: "testhost",
      multiUser: false,
      sources: sampleSources,
    });
  });

  test("displays policy badges for defined policies", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      // Check for policy badges (retention, scheduling, etc.)
      expect(screen.getAllByText("retention")).toHaveLength(4);
      expect(screen.getAllByText("scheduling")).toHaveLength(2);
    });
  });

  test("shows edit buttons for each policy", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      const editButtons = screen.getAllByTestId("edit-policy");
      expect(editButtons).toHaveLength(4);
    });
  });

  test("displays correct policy data in table", async () => {
    renderWithProviders(<Policies />);

    await waitFor(() => {
      expect(screen.getByText("/home/testuser")).toBeInTheDocument();
      expect(screen.getByText("/documents")).toBeInTheDocument();
    });

    // Every row links its target to the policy editor and has an Edit button.
    const links = [...document.querySelectorAll("a.source-link")].map((a) => a.getAttribute("href"));
    expect(links.sort()).toEqual(samplePolicies.map((p) => policyEditorURL(p.target)).sort());
    expect(screen.getAllByTestId("edit-policy")).toHaveLength(4);
  });
});
