import { Textarea, type TextareaProps } from "@mantine/core";

/**
 * A line break becomes a space, so the stored value stays one line. A break at
 * the end is dropped instead: some phone keyboards send Enter as a typed "\n".
 */
const flattenLines = (v: string) => v.replace(/[\r\n]+$/, "").replace(/[\r\n]+/g, " ");

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
      // Flatten a multi-line paste where it lands, so the caret stays there
      // (and, where the browser supports it, the paste can be undone).
      onPaste={(e) => {
        const text = e.clipboardData.getData("text");
        if (/[\r\n]/.test(text)) {
          e.preventDefault();
          const box = e.currentTarget;
          const flat = text.replace(/[\r\n]+/g, " ");
          if (!document.execCommand?.("insertText", false, flat)) {
            box.setRangeText(flat, box.selectionStart, box.selectionEnd, "end");
            onChange(box.value);
          }
        }
        rest.onPaste?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
        rest.onKeyDown?.(e);
      }}
    />
  );
}
