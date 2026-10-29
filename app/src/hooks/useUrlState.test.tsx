import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { urlCodec, useUrlState } from "./useUrlState";

function Counter() {
  const [count, setCount] = useUrlState("n", urlCodec.number(0), 0);
  const location = useLocation();
  return (
    <>
      <output data-testid="count">{count}</output>
      <output data-testid="search">{location.search}</output>
      <button
        type="button"
        onClick={() => {
          setCount((previous) => previous + 1);
          setCount((previous) => previous + 1);
        }}
      >
        add two
      </button>
      <button type="button" onClick={() => setCount(0)}>reset</button>
    </>
  );
}

describe("useUrlState", () => {
  afterEach(() => vi.restoreAllMocks());

  it("chains functional updates and mirrors them in the URL without updating the router during render", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={["/map?n=3"]}>
        <Counter />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("count").textContent).toBe("3");

    act(() => screen.getByText("add two").click());
    expect(screen.getByTestId("count").textContent).toBe("5");
    expect(screen.getByTestId("search").textContent).toBe("?n=5");

    // The default serializes to an absent parameter.
    act(() => screen.getByText("reset").click());
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("search").textContent).toBe("");

    const renderPhaseUpdates = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes("while rendering a different component"),
    );
    expect(renderPhaseUpdates).toEqual([]);
  });
});
