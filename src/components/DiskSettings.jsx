import React from "react";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import PropTypes from "prop-types";
import { Link } from "react-router";
import { DiskRetention } from "./ImageRetention";

/**
 * The settings of one disk's images, opened from the disk's group on the
 * Images tab: what its own policy sets, which overrides this computer's
 * settings and the repository defaults.
 */
export function DiskSettings({ source, title, children, onHide }) {
  return (
    <Modal show={!!source} onHide={onHide} size="lg" data-testid="disk-settings">
      <Modal.Header closeButton>
        <Modal.Title>{title} Settings</Modal.Title>
      </Modal.Header>
      {source && (
        <Modal.Body>
          {children}
          <h5>Retention</h5>
          <p className="text-muted">
            Which images of this disk are kept. Every image run applies it when it ends, and the space of the images it
            deletes is freed when the repository&apos;s full maintenance runs. Empty settings use this computer&apos;s
            settings, or else the{" "}
            <Link to="/repo?tab=defaults" onClick={onHide}>
              repository defaults
            </Link>
            . Keep weekly and monthly images too, to be able to go back to before an infection that waited to strike.
          </p>
          <DiskRetention source={source} />
        </Modal.Body>
      )}
      <Modal.Footer>
        <Button size="sm" variant="secondary" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

DiskSettings.propTypes = {
  source: PropTypes.object,
  title: PropTypes.string,
  children: PropTypes.node,
  onHide: PropTypes.func.isRequired,
};
