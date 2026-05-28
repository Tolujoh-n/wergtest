import React from 'react';
import { useSlate } from 'slate-react';
import { 
  Editor, 
  Element as SlateElement,
  Transforms,
  Range,
} from 'slate';

const ToolbarButton = ({ active, onMouseDown, children, title }) => (
  <button
    onMouseDown={onMouseDown}
    className={`px-3 py-2 rounded ${
      active
        ? 'bg-blue-500 text-white'
        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
    }`}
    title={title}
  >
    {children}
  </button>
);

const isMarkActive = (editor, format) => {
  const marks = Editor.marks(editor);
  return marks ? marks[format] === true : false;
};

const toggleMark = (editor, format) => {
  const isActive = isMarkActive(editor, format);
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

const isBlockActive = (editor, format) => {
  const { selection } = editor;
  if (!selection) return false;

  const [match] = Array.from(
    Editor.nodes(editor, {
      at: Editor.unhangRange(editor, selection),
      match: n =>
        !Editor.isEditor(n) &&
        SlateElement.isElement(n) &&
        n.type === format,
    })
  );

  return !!match;
};

const toggleBlock = (editor, format) => {
  const isActive = isBlockActive(editor, format);
  const isList = ['bulleted-list', 'numbered-list'].includes(format);

  Transforms.unwrapNodes(editor, {
    match: n =>
      !Editor.isEditor(n) &&
      SlateElement.isElement(n) &&
      ['bulleted-list', 'numbered-list'].includes(n.type),
    split: true,
  });

  let newProperties;
  if (isActive) {
    newProperties = { type: 'paragraph' };
  } else if (isList) {
    newProperties = { type: 'list-item' };
    Transforms.wrapNodes(editor, { type: format, children: [] });
  } else {
    newProperties = { type: format };
  }

  Transforms.setNodes(editor, newProperties);
};

const SlateToolbar = () => {
  const editor = useSlate();

  return (
    <div className="flex flex-wrap gap-2 p-2 border-b border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 rounded-t-lg">
      <ToolbarButton
        active={isMarkActive(editor, 'bold')}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleMark(editor, 'bold');
        }}
        title="Bold"
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        active={isMarkActive(editor, 'italic')}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleMark(editor, 'italic');
        }}
        title="Italic"
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        active={isMarkActive(editor, 'underline')}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleMark(editor, 'underline');
        }}
        title="Underline"
      >
        <u>U</u>
      </ToolbarButton>
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1"></div>
      <ToolbarButton
        active={isBlockActive(editor, 'heading-one')}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleBlock(editor, 'heading-one');
        }}
        title="Heading 1"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        active={isBlockActive(editor, 'heading-two')}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleBlock(editor, 'heading-two');
        }}
        title="Heading 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        active={isBlockActive(editor, 'heading-three')}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleBlock(editor, 'heading-three');
        }}
        title="Heading 3"
      >
        H3
      </ToolbarButton>
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1"></div>
      <ToolbarButton
        active={isBlockActive(editor, 'bulleted-list')}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleBlock(editor, 'bulleted-list');
        }}
        title="Bullet List"
      >
        •
      </ToolbarButton>
      <ToolbarButton
        active={isBlockActive(editor, 'numbered-list')}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleBlock(editor, 'numbered-list');
        }}
        title="Numbered List"
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        onMouseDown={(e) => {
          e.preventDefault();
          const url = window.prompt('Enter URL:');
          if (url) {
            insertLink(editor, url);
          }
        }}
        title="Insert Link"
      >
        🔗
      </ToolbarButton>
    </div>
  );
};

const insertLink = (editor, url) => {
  if (editor.selection) {
    wrapLink(editor, url);
  }
};

const wrapLink = (editor, url) => {
  const isActive = isLinkActive(editor);
  if (isActive) {
    unwrapLink(editor);
  }

  const { selection } = editor;
  const isCollapsed = selection && Range.isCollapsed(selection);
  const link = {
    type: 'link',
    url,
    children: isCollapsed ? [{ text: url }] : [],
  };

  if (isCollapsed) {
    Transforms.insertNodes(editor, link);
  } else {
    Transforms.wrapNodes(editor, link, { split: true });
    Transforms.collapse(editor, { edge: 'end' });
  }
};

const unwrapLink = (editor) => {
  Transforms.unwrapNodes(editor, {
    match: n =>
      !Editor.isEditor(n) &&
      SlateElement.isElement(n) &&
      n.type === 'link',
  });
};

const isLinkActive = (editor) => {
  const [link] = Editor.nodes(editor, {
    match: n =>
      !Editor.isEditor(n) &&
      SlateElement.isElement(n) &&
      n.type === 'link',
  });
  return !!link;
};

export default SlateToolbar;
