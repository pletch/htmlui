import React from "react";
import { Link } from "react-router";
import { faFile, faFolder } from "@fortawesome/free-regular-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import KopiaTable from "./KopiaTable";
import { objectLink, rfc3339TimestampForDisplay } from "../utils/formatutils";
import { sizeWithFailures } from "../utils/uiutil";
import { UIPreferencesContext } from "../contexts/UIPreferencesContext";
import PropTypes from "prop-types";

function objectName(name, typeID) {
  if (typeID === "d") {
    return name + "/";
  }

  return name;
}

function sizeInfo(item) {
  if (item.size) {
    return item.size;
  }

  if (item.summ && item.summ.size) {
    return item.summ.size;
  }

  return 0;
}

function directoryLinkOrDownload(x, state) {
  if (x.obj.startsWith("k")) {
    return (
      <Link to={objectLink(x.obj)} state={{ label: x.name, oid: x.obj, prevState: state }}>
        {objectName(x.name, x.type)}
      </Link>
    );
  }

  return <a href={"/api/v1/objects/" + x.obj + "?fname=" + encodeURIComponent(x.name)}>{x.name}</a>;
}

export function DirectoryItems({ historyState, items }) {
  const context = React.use(UIPreferencesContext);

  const { bytesStringBase2 } = context;
  const columns = [
    {
      id: "name",
      header: "Name",
      // directories sort before files
      accessorFn: (x) => (x.type === "d" ? "0" : "1") + x.name,
      meta: { className: "col-source" },
      cell: (x) => (
        <span className="dir-entry">
          <FontAwesomeIcon
            className="dir-entry-icon"
            icon={x.row.original.type === "d" ? faFolder : faFile}
            data-testid={x.row.original.type === "d" ? "dir-icon" : "file-icon"}
          />
          {directoryLinkOrDownload(x.row.original, historyState)}
        </span>
      ),
    },
    {
      id: "mtime",
      accessorFn: (x) => x.mtime,
      header: "Modified",
      meta: { className: "col-num" },
      cell: (x) => rfc3339TimestampForDisplay(x.cell.getValue()),
    },
    {
      id: "size",
      accessorFn: (x) => sizeInfo(x),
      header: "Size",
      meta: { className: "col-num" },
      cell: (x) => sizeWithFailures(x.cell.getValue(), x.row.original.summ, bytesStringBase2),
    },
    {
      id: "files",
      accessorFn: (x) => (x.summ ? x.summ.files : undefined),
      header: "Files / Dirs",
      meta: { className: "col-num col-time" },
      cell: (x) =>
        x.row.original.summ ? (
          <>
            <span className="time-last">{(x.row.original.summ.files ?? 0).toLocaleString()}</span>
            <span className="time-next">{(x.row.original.summ.dirs ?? 0).toLocaleString()} dirs</span>
          </>
        ) : null,
    },
  ];

  return <KopiaTable data={items} columns={columns} />;
}

DirectoryItems.propTypes = {
  historyState: PropTypes.object,
  items: PropTypes.array.isRequired,
};
