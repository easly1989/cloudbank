import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { WrapText } from "./WrapText";

describe("WrapText", () => {
  // jsdom has no document.fonts, which the autosizing textarea listens to.
  beforeAll(() => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { addEventListener() {}, removeEventListener() {} },
    });
  });

  it("flattens pasted line breaks into spaces and swallows Enter", () => {
    const onChange = vi.fn();
    render(
      <MantineProvider>
        <WrapText label="Memo" value="" onChange={onChange} />
      </MantineProvider>,
    );
    const box = screen.getByLabelText("Memo");
    fireEvent.change(box, { target: { value: "one\ntwo" } });
    expect(onChange).toHaveBeenCalledWith("one two");
    // fireEvent returns false when the default action was prevented.
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(box, { key: "Enter", shiftKey: true })).toBe(false);
  });
});
