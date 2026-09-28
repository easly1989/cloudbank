import {
  Group,
  Select,
  Text,
  defaultOptionsFilter,
  type ComboboxItem,
  type ComboboxParsedItem,
  type OptionsFilter,
  type SelectProps,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import { sameName } from "../sameName";

const CREATE = "__create__";

// CreatableSelect is a searchable Select that offers to create what was typed
// when it matches nothing (#531): "+ Create «Coffee»" as the last option. It is
// not offered for a name that already exists, whatever its case — that one is
// in the list already, and picking it is the answer.
export function CreatableSelect({
  names,
  createLabel,
  onCreate,
  onChange,
  data,
  ...props
}: Omit<SelectProps, "data" | "onChange" | "searchable" | "searchValue" | "onSearchChange"> & {
  data: ComboboxItem[];
  /** Every existing name, to tell whether the typed one is new. */
  names: string[];
  createLabel: (name: string) => string;
  /** Creates the entry and resolves to the value to select, if any. */
  onCreate: (name: string) => Promise<string | null>;
  onChange: (value: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const typed = search.trim();
  const isNew =
    typed !== "" &&
    !names.some((n) => sameName(n, typed)) &&
    !data.some((o) => sameName(o.label, typed));
  const options = isNew ? [...data, { value: CREATE, label: createLabel(typed) }] : data;

  // The create option stays whatever the filter thinks of its label.
  const filter: OptionsFilter = (input) => {
    const rest = input.options.filter((o) => !("value" in o && o.value === CREATE));
    const found = defaultOptionsFilter({ ...input, options: rest }) as ComboboxParsedItem[];
    return isNew ? [...found, { value: CREATE, label: createLabel(typed) }] : found;
  };

  return (
    <Select
      // Picking the selected one again keeps it: clearing is the × button's.
      allowDeselect={false}
      {...props}
      data={options}
      searchable
      searchValue={search}
      onSearchChange={setSearch}
      filter={filter}
      renderOption={({ option }) =>
        option.value === CREATE ? (
          <Group gap={8} wrap="nowrap" c="var(--mantine-primary-color-filled)">
            <IconPlus size={16} style={{ flexShrink: 0 }} />
            <Text inherit fw={500}>
              {option.label}
            </Text>
          </Group>
        ) : (
          option.label
        )
      }
      onChange={(v) => {
        if (v !== CREATE) onChange(v);
      }}
      onOptionSubmit={(v) => {
        if (v !== CREATE || creating) return;
        setCreating(true);
        void onCreate(typed)
          .then((value) => {
            if (value != null) onChange(value);
          })
          .finally(() => setCreating(false));
      }}
    />
  );
}
