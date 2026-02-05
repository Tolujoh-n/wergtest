import React, { useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';

const TiptapEditor = ({ value, onChange, placeholder = 'Start writing...', showToolbar = false }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        // Exclude link and underline from StarterKit since we're adding them separately
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-500 hover:underline',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg my-4',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      if (onChange) {
        try {
          onChange(editor.getJSON());
        } catch (error) {
          console.error('Error in onUpdate:', error);
        }
      }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-lg dark:prose-invert max-w-none min-h-[300px] p-4 focus:outline-none text-gray-900 dark:text-white text-left',
      },
    },
  });

  // Update editor content when value prop changes
  useEffect(() => {
    if (editor && value !== undefined) {
      const currentContent = JSON.stringify(editor.getJSON());
      const newContent = JSON.stringify(value);
      
      if (currentContent !== newContent) {
        editor.commands.setContent(value || '');
      }
    }
  }, [value, editor]);

  const toggleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);

  const toggleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run();
  }, [editor]);

  const setHeading = useCallback((level) => {
    editor?.chain().focus().toggleHeading({ level }).run();
  }, [editor]);

  const toggleBulletList = useCallback(() => {
    editor?.chain().focus().toggleBulletList().run();
  }, [editor]);

  const toggleOrderedList = useCallback(() => {
    editor?.chain().focus().toggleOrderedList().run();
  }, [editor]);

  const setLink = useCallback(() => {
    const url = window.prompt('Enter URL:');
    if (url) {
      editor?.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) {
    return (
      <div className="border border-gray-300 dark:border-gray-600 rounded-lg min-h-[300px] bg-white dark:bg-gray-800 p-4">
        <p className="text-gray-500 dark:text-gray-400">Loading editor...</p>
      </div>
    );
  }

  return (
    <div className="tiptap-editor border border-gray-300 dark:border-gray-600 rounded-lg min-h-[300px] bg-white dark:bg-gray-800">
      {showToolbar && (
        <div className="border-b border-gray-300 dark:border-gray-600 p-2 flex flex-wrap gap-2 bg-gray-50 dark:bg-gray-900">
          <button
            type="button"
            onClick={toggleBold}
            className={`px-3 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
              editor.isActive('bold') ? 'bg-gray-300 dark:bg-gray-600' : ''
            }`}
            title="Bold"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            onClick={toggleItalic}
            className={`px-3 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
              editor.isActive('italic') ? 'bg-gray-300 dark:bg-gray-600' : ''
            }`}
            title="Italic"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            onClick={() => setHeading(1)}
            className={`px-3 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
              editor.isActive('heading', { level: 1 }) ? 'bg-gray-300 dark:bg-gray-600' : ''
            }`}
            title="Heading 1"
          >
            H1
          </button>
          <button
            type="button"
            onClick={() => setHeading(2)}
            className={`px-3 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
              editor.isActive('heading', { level: 2 }) ? 'bg-gray-300 dark:bg-gray-600' : ''
            }`}
            title="Heading 2"
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => setHeading(3)}
            className={`px-3 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
              editor.isActive('heading', { level: 3 }) ? 'bg-gray-300 dark:bg-gray-600' : ''
            }`}
            title="Heading 3"
          >
            H3
          </button>
          <button
            type="button"
            onClick={toggleBulletList}
            className={`px-3 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
              editor.isActive('bulletList') ? 'bg-gray-300 dark:bg-gray-600' : ''
            }`}
            title="Bullet List"
          >
            •
          </button>
          <button
            type="button"
            onClick={toggleOrderedList}
            className={`px-3 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
              editor.isActive('orderedList') ? 'bg-gray-300 dark:bg-gray-600' : ''
            }`}
            title="Numbered List"
          >
            1.
          </button>
          <button
            type="button"
            onClick={setLink}
            className={`px-3 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
              editor.isActive('link') ? 'bg-gray-300 dark:bg-gray-600' : ''
            }`}
            title="Insert Link"
          >
            🔗
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
      <style>{`
        .tiptap-editor .ProseMirror {
          outline: none;
          min-height: 250px;
          text-align: left;
        }
        .tiptap-editor .ProseMirror p,
        .tiptap-editor .ProseMirror h1,
        .tiptap-editor .ProseMirror h2,
        .tiptap-editor .ProseMirror h3,
        .tiptap-editor .ProseMirror ul,
        .tiptap-editor .ProseMirror ol {
          text-align: left;
        }
        .tiptap-editor .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #9ca3af;
          pointer-events: none;
          height: 0;
        }
        .tiptap-editor .ProseMirror ul,
        .tiptap-editor .ProseMirror ol {
          padding-left: 1.5rem;
          margin: 0.5rem 0;
        }
        .tiptap-editor .ProseMirror h1 {
          font-size: 2rem;
          font-weight: bold;
          margin: 1rem 0;
        }
        .tiptap-editor .ProseMirror h2 {
          font-size: 1.5rem;
          font-weight: bold;
          margin: 0.75rem 0;
        }
        .tiptap-editor .ProseMirror h3 {
          font-size: 1.25rem;
          font-weight: bold;
          margin: 0.5rem 0;
        }
        .tiptap-editor .ProseMirror a {
          color: #3b82f6;
          text-decoration: underline;
        }
        .tiptap-editor .ProseMirror a:hover {
          color: #2563eb;
        }
        .tiptap-editor .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 1rem 0;
        }
      `}</style>
    </div>
  );
};

export default TiptapEditor;
