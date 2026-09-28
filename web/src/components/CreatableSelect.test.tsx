import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { CreatableSelect } from "./CreatableSelect";

function Harness({ onCreate }: { onCreate: (name: string) => Promise<string | null> }) {
  const [data, setData] = useState([{ value: "1", label: "Bar Centrale" }]);
  const [value, setValue] = useState<string | null>(null);
  return (
    <MantineProvider>
      <CreatableSelect
        label="Payee"
        data={data}
        names={data.map((o) => o.label)}
        createLabel={(name) => `Add “${name}”`}
        onCreate={async (name) => {
          const id = await onCreate(name);
          if (id) setData((d) => [...d, { value: id, label: name }]);
          return id;
        }}
        value={value}
        onChange={setValue}
      />
      <output>{value ?? "none"}</output>
    </MantineProvider>
  );
}

const type = (text: string) => {
  const input = screen.getAllByLabelText("Payee").find((e) => e.tagName === "INPUT")!;
  input.focus();
  fireEvent.change(input, { target: { value: text } });
};

describe("CreatableSelect", () => {
  // jsdom has no layout, and the combobox scrolls its selected option into view.
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  it("offers to create a name that matches nothing, and selects what it made", async () => {
    const onCreate = vi.fn(async () => "2");
    render(<Harness onCreate={onCreate} />);
    type("  Farmacia ");
    fireEvent.click(await screen.findByText("Add “Farmacia”"));
    expect(onCreate).toHaveBeenCalledWith("Farmacia");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2"));
  });

  it("does not offer a name that exists in another case", async () => {
    render(<Harness onCreate={vi.fn()} />);
    type("bar centrale");
    expect(await screen.findByText("Bar Centrale")).toBeInTheDocument();
    expect(screen.queryByText(/^Add /)).not.toBeInTheDocument();
  });
});
