import {
  newDataBytesCell,
  newDataBytesTitle,
  snapshotSizeCell,
  toAlgorithmOption,
  uploadedBytesCell,
  uploadedBytesTitle,
} from "../../src/utils/uiutil";

describe("newDataBytesCell", () => {
  it("shows the new data with its explanation", () => {
    const cell = newDataBytesCell(7500000, false);
    expect(cell.props.children).toBe("7.5 MB");
    expect(cell.props.title).toBe(newDataBytesTitle);
  });

  it("shows nothing for snapshots taken before kopia recorded it", () => {
    expect(newDataBytesCell(undefined, false)).toBe("");
    expect(newDataBytesCell(null, false)).toBe("");
  });
});

describe("toAlgorithmOption", () => {
  it("creates basic option element", () => {
    const algorithm = { id: "sha256" };
    const option = toAlgorithmOption(algorithm);
    expect(option.props.value).toBe("sha256");
    expect(option.props.children).toBe("sha256");
  });

  it("marks recommended algorithm", () => {
    const algorithm = { id: "sha256" };
    const option = toAlgorithmOption(algorithm, "sha256");
    expect(option.props.children).toBe("sha256 (RECOMMENDED)");
  });

  it("marks deprecated algorithm", () => {
    const algorithm = { id: "md5", deprecated: true };
    const option = toAlgorithmOption(algorithm);
    expect(option.props.children).toBe("md5 (NOT RECOMMENDED)");
  });
});

describe("uploadedBytesCell", () => {
  it("shows the bytes uploaded", () => {
    const cell = uploadedBytesCell(2500000, false);
    expect(cell.props.children).toBe("2.5 MB");
    expect(cell.props.title).toBe(uploadedBytesTitle);
  });

  it("uses base-2 units when asked", () => {
    expect(uploadedBytesCell(2 * 1024 * 1024, true).props.children).toBe("2 MiB");
  });

  it("shows zero for a snapshot that uploaded nothing", () => {
    expect(uploadedBytesCell(0, false).props.children).toBe("0 B");
  });

  it("shows nothing for snapshots taken before kopia recorded it", () => {
    expect(uploadedBytesCell(undefined, false)).toBe("");
    expect(uploadedBytesCell(null, false)).toBe("");
    expect(uploadedBytesCell(-1, false)).toBe("");
  });
});

describe("snapshotSizeCell", () => {
  it("shows the total size of a file snapshot", () => {
    const cell = snapshotSizeCell(undefined, 2048, null, false);
    expect(cell.props.children).toBe("2 KB");
    expect(cell.props.title).toBeUndefined();
  });

  it("shows the bytes read for an image, with the disk size in the tooltip", () => {
    const cell = snapshotSizeCell(611e9, 1e12, null, false);
    expect(cell.props.children).toBe("611 GB");
    expect(cell.props.title).toContain("1 TB");
  });

  it("treats a null imageBytesRead as a file snapshot", () => {
    const cell = snapshotSizeCell(null, 2048, null, false);
    expect(cell.props.children).toBe("2 KB");
  });
});
