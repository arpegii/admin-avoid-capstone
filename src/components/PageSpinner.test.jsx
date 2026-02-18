import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PageSpinner from "./PageSpinner";

afterEach(() => {
  cleanup();
});

describe("PageSpinner", () => {
  it("renders default loading label", () => {
    render(<PageSpinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders custom label and fullscreen class", () => {
    render(<PageSpinner fullScreen label="Loading dashboard..." />);
    const status = screen.getByRole("status");
    expect(status).toHaveClass("fullscreen");
    expect(screen.getByText("Loading dashboard...")).toBeInTheDocument();
  });
});
