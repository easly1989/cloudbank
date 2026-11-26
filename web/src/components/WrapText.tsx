import { Textarea, type TextareaProps } from "@mantine/core";

/** A pasted line break becomes a space: the stored value stays one line. */
const flattenLines = (v: string) => v.replace(/[\r\n]+/g, " ");

type Props = Omit<TextareaProps, "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * A free-text line that wraps and grows (up to six rows, then scrolls) so a
 * long memo can be read whole. It is still one line of data: Enter and
 * Shift+Enter insert nothing — the form's own Enter handling still sees the
 * key — and pasted line breaks become spaces.
 */
export function WrapText({ onChange, ...rest }: Props) {
  return (
    <Textarea
      autosize
      minRows={1}
      maxRows={6}
      {...rest}
      onChange={(e) => onChange(flattenLines(e.currentTarget.value))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
        rest.onKeyDown?.(e);
      }}
    />
  );
}
