import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { notesToEditorContent } from "@/lib/notesHtml";

type NotesEditorProps = {
  initialContent: string;
  disabled?: boolean;
  onReady?: (editorEl: HTMLElement | null) => void;
  onChange: (html: string) => void;
};

const toolbarBtnClass =
  "rounded-md border border-stone-300 bg-stone-50 px-2 py-1 text-xs font-semibold text-stone-800 disabled:opacity-50 dark:border-stone-600 dark:bg-[#2a1c14] dark:text-amber-50";

const toolbarBtnActiveClass =
  "border-orange-800 bg-orange-100 text-orange-950 dark:border-orange-400 dark:bg-orange-950/50 dark:text-orange-100";

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
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        code: false,
        link: false,
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
        <button
          type="button"
          tabIndex={-1}
          data-testid="notes-bold"
          disabled={disabled}
          aria-pressed={editor.isActive("bold")}
          className={`${toolbarBtnClass} ${editor.isActive("bold") ? toolbarBtnActiveClass : ""}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-testid="notes-italic"
          disabled={disabled}
          aria-pressed={editor.isActive("italic")}
          className={`${toolbarBtnClass} ${editor.isActive("italic") ? toolbarBtnActiveClass : ""}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-testid="notes-underline"
          disabled={disabled}
          aria-pressed={editor.isActive("underline")}
          className={`${toolbarBtnClass} ${editor.isActive("underline") ? toolbarBtnActiveClass : ""}`}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          Underline
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-testid="notes-bullet-list"
          disabled={disabled}
          aria-pressed={editor.isActive("bulletList")}
          className={`${toolbarBtnClass} ${editor.isActive("bulletList") ? toolbarBtnActiveClass : ""}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          Bullet list
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-testid="notes-numbered-list"
          disabled={disabled}
          aria-pressed={editor.isActive("orderedList")}
          className={`${toolbarBtnClass} ${editor.isActive("orderedList") ? toolbarBtnActiveClass : ""}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          Numbered list
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
