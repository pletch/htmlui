import { snapshotSizeCell, toAlgorithmOption } from "../../src/utils/uiutil";

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
