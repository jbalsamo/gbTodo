import { useEffect, useRef, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
} from "lucide-react";
import { notesToEditorContent } from "@/lib/notesHtml";

type NotesEditorProps = {
  initialContent: string;
  disabled?: boolean;
  onReady?: (editorEl: HTMLElement | null) => void;
  onChange: (html: string) => void;
};

/** Shared idle/pressed styles for every notes toolbar control (no per-button color drift). */
const toolbarBtnBaseClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border shadow-sm transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-800 dark:focus-visible:ring-orange-400";

const toolbarBtnIdleClass =
  "border-stone-400 bg-stone-100 text-stone-950 hover:bg-amber-50 dark:border-stone-600 dark:bg-[#2a1c14] dark:text-amber-50 dark:hover:bg-[#3d2a1f]";

const toolbarBtnPressedClass =
  "border-orange-900 bg-orange-800 text-amber-50 hover:bg-orange-700 dark:border-orange-300 dark:bg-orange-400 dark:text-stone-950 dark:hover:bg-orange-300";

function toolbarBtnClass(pressed: boolean) {
  return `${toolbarBtnBaseClass} ${pressed ? toolbarBtnPressedClass : toolbarBtnIdleClass}`;
}

type ToolbarButtonProps = {
  testId: string;
  label: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
};

function ToolbarButton({
  testId,
  label,
  pressed,
  disabled,
  onClick,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-testid={testId}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={toolbarBtnClass(pressed)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const iconProps = { size: 16, strokeWidth: 2.25, "aria-hidden": true as const };

export function NotesEditor({
  initialContent,
  disabled = false,
  onReady,
  onChange,
}: NotesEditorProps) {
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  const readyNotified = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        code: false,
        link: false,
        // Underline is wired explicitly via @tiptap/extension-underline below.
        underline: false,
      }),
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
    ],
    content: notesToEditorContent(initialContent),
    editable: !disabled,
    editorProps: {
      attributes: {
        "data-testid": "notes-editor",
        tabindex: "0",
        class:
          "notes-editor min-h-[9rem] w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-orange-800 focus:ring-2 focus:ring-orange-800/30 dark:border-stone-700 dark:bg-[#2a1c14] dark:text-stone-100 dark:focus:border-orange-400 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        role: "textbox",
        "aria-label": "Todo notes",
        "aria-multiline": "true",
      },
    },
    onCreate: ({ editor: ed }) => {
      onChangeRef.current(ed.getHTML());
    },
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current(ed.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor || readyNotified.current) return;
    readyNotified.current = true;
    const el = editor.view.dom as HTMLElement;
    onReadyRef.current?.(el);
  }, [editor]);

  if (!editor) {
    return (
      <div
        data-testid="notes-editor-loading"
        className="mt-3 min-h-[9rem] rounded-xl border border-stone-300 dark:border-stone-700"
      />
    );
  }

  return (
    <div className="mt-3" data-testid="notes-editor-root">
      <div
        className="mb-2 flex flex-wrap gap-1"
        role="toolbar"
        aria-label="Notes formatting"
        data-testid="notes-toolbar"
      >
        <ToolbarButton
          testId="notes-bold"
          label="Bold"
          pressed={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold {...iconProps} />
        </ToolbarButton>
        <ToolbarButton
          testId="notes-italic"
          label="Italic"
          pressed={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic {...iconProps} />
        </ToolbarButton>
        <ToolbarButton
          testId="notes-underline"
          label="Underline"
          pressed={editor.isActive("underline")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon {...iconProps} />
        </ToolbarButton>
        <ToolbarButton
          testId="notes-bullet-list"
          label="Bullet list"
          pressed={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List {...iconProps} />
        </ToolbarButton>
        <ToolbarButton
          testId="notes-numbered-list"
          label="Numbered list"
          pressed={editor.isActive("orderedList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered {...iconProps} />
        </ToolbarButton>
        <ToolbarButton
          testId="notes-align-left"
          label="Align left"
          pressed={editor.isActive({ textAlign: "left" })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft {...iconProps} />
        </ToolbarButton>
        <ToolbarButton
          testId="notes-align-center"
          label="Align center"
          pressed={editor.isActive({ textAlign: "center" })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter {...iconProps} />
        </ToolbarButton>
        <ToolbarButton
          testId="notes-align-right"
          label="Align right"
          pressed={editor.isActive({ textAlign: "right" })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight {...iconProps} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
