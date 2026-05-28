import React, { useMemo, useEffect, useCallback } from 'react';
import { createEditor } from 'slate';
import { Slate, Editable, withReact } from 'slate-react';
import { withHistory } from 'slate-history';
import SlateToolbar from './SlateToolbar';

const SlateEditor = ({ value, onChange, placeholder = 'Start writing...', showToolbar = false }) => {
  const editor = useMemo(() => withHistory(withReact(createEditor())), []);
  
  // Ensure value is never undefined - normalize immediately
  const normalizedPropValue = React.useMemo(() => {
    return value !== undefined ? value : null;
  }, [value]);

  // Helper function to validate and normalize Slate value
  const normalizeValue = (val) => {
    // Handle null, undefined, or any falsy value
    if (val === null || val === undefined || (!val && val !== 0 && val !== false)) {
      return DEFAULT_EDITOR_VALUE;
    }

    // If it's a string, try to parse it as JSON
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed) && parsed.length > 0) {
          val = parsed;
        } else {
          // If parsing fails or result is invalid, convert string to paragraph
          return [
            {
              type: 'paragraph',
              children: [{ text: val }],
            },
          ];
        }
      } catch (e) {
        // If JSON parse fails, treat as plain text
        return [
          {
            type: 'paragraph',
            children: [{ text: val }],
          },
        ];
      }
    }

    // Check if value is valid Slate format (array)
    if (Array.isArray(val) && val.length > 0) {
      // Validate that it's a proper Slate structure
      const isValid = val.every(node => 
        node && 
        typeof node === 'object' && 
        node.type && 
        Array.isArray(node.children)
      );
      if (isValid) {
        return val;
      }
    }

    // Return default empty paragraph for any other invalid format
    return [
      {
        type: 'paragraph',
        children: [{ text: '' }],
      },
    ];
  };

  // Default empty value - defined as constant to avoid closure issues
  const DEFAULT_EDITOR_VALUE = [
    {
      type: 'paragraph',
      children: [{ text: '' }],
    },
  ];

  const defaultValue = React.useMemo(() => DEFAULT_EDITOR_VALUE, []);

  const [editorValue, setEditorValue] = React.useState(() => {
    try {
      const normalized = normalizeValue(normalizedPropValue);
      // Ensure we always return a valid array
      if (normalized && Array.isArray(normalized) && normalized.length > 0) {
        return normalized;
      }
      return DEFAULT_EDITOR_VALUE;
    } catch (e) {
      console.error('Error initializing editor value:', e);
      return DEFAULT_EDITOR_VALUE;
    }
  });

  // Sync external value changes
  useEffect(() => {
    try {
      const normalized = normalizeValue(normalizedPropValue);
      // Ensure normalized is always valid
      const validValue = (normalized && Array.isArray(normalized) && normalized.length > 0) 
        ? normalized 
        : DEFAULT_EDITOR_VALUE;
      
      setEditorValue(prevValue => {
        if (!prevValue || !Array.isArray(prevValue) || prevValue.length === 0) {
          return validValue;
        }
        if (JSON.stringify(validValue) !== JSON.stringify(prevValue)) {
          return validValue;
        }
        return prevValue;
      });
    } catch (e) {
      console.error('Error syncing editor value:', e);
      setEditorValue(DEFAULT_EDITOR_VALUE);
    }
  }, [normalizedPropValue]);

  const handleChange = useCallback((newValue) => {
    // Ensure we never set undefined or invalid values
    const validValue = (newValue && Array.isArray(newValue) && newValue.length > 0)
      ? newValue
      : DEFAULT_EDITOR_VALUE;
    
    setEditorValue(validValue);
    if (onChange) {
      onChange(validValue);
    }
  }, [onChange]);

  // Ensure editorValue is always valid before rendering Slate
  const safeEditorValue = React.useMemo(() => {
    // If editorValue is invalid in any way, use default
    if (!editorValue || !Array.isArray(editorValue)) {
      return DEFAULT_EDITOR_VALUE;
    }
    
    // Empty array is technically valid but we'll use default for consistency
    if (editorValue.length === 0) {
      return DEFAULT_EDITOR_VALUE;
    }
    
    // Validate structure - ensure all nodes have required properties
    const isValid = editorValue.every(node => {
      return (
        node && 
        typeof node === 'object' && 
        node.type && 
        typeof node.type === 'string' &&
        Array.isArray(node.children) &&
        node.children.length > 0
      );
    });
    
    if (!isValid) {
      return DEFAULT_EDITOR_VALUE;
    }
    
    return editorValue;
  }, [editorValue]);

  // Use direct fallback in JSX to ensure value is never undefined
  const finalValue = safeEditorValue || DEFAULT_EDITOR_VALUE;

  return (
    <div className="border border-gray-300 dark:border-gray-600 rounded-lg min-h-[300px] bg-white dark:bg-gray-800">
      <Slate editor={editor} value={finalValue} onChange={handleChange}>
        {showToolbar && <SlateToolbar />}
        <Editable
          placeholder={placeholder}
          className="outline-none min-h-[250px] p-4 text-gray-900 dark:text-white"
          renderElement={({ attributes, children, element }) => {
            switch (element.type) {
              case 'heading-one':
                return <h1 {...attributes} className="text-3xl font-bold mb-4">{children}</h1>;
              case 'heading-two':
                return <h2 {...attributes} className="text-2xl font-bold mb-3">{children}</h2>;
              case 'heading-three':
                return <h3 {...attributes} className="text-xl font-bold mb-2">{children}</h3>;
              case 'bulleted-list':
                return <ul {...attributes} className="list-disc list-inside mb-2 ml-4">{children}</ul>;
              case 'numbered-list':
                return <ol {...attributes} className="list-decimal list-inside mb-2 ml-4">{children}</ol>;
              case 'list-item':
                return <li {...attributes} className="mb-1">{children}</li>;
              case 'link':
                return (
                  <a {...attributes} href={element.url} className="text-blue-500 hover:underline">
                    {children}
                  </a>
                );
              case 'table':
                return (
                  <table {...attributes} className="border-collapse border border-gray-300 dark:border-gray-600 my-4 w-full">
                    <tbody>{children}</tbody>
                  </table>
                );
              case 'table-row':
                return <tr {...attributes}>{children}</tr>;
              case 'table-cell':
                return (
                  <td {...attributes} className="border border-gray-300 dark:border-gray-600 px-4 py-2">
                    {children}
                  </td>
                );
              case 'iframe':
                return (
                  <iframe
                    {...attributes}
                    src={element.url}
                    className="w-full h-64 my-4"
                    frameBorder="0"
                    allowFullScreen
                    title="Embedded content"
                  />
                );
              default:
                return <p {...attributes} className="mb-2">{children}</p>;
            }
          }}
          renderLeaf={({ attributes, children, leaf }) => {
            let el = <span {...attributes}>{children}</span>;
            if (leaf.bold) {
              el = <strong>{el}</strong>;
            }
            if (leaf.italic) {
              el = <em>{el}</em>;
            }
            if (leaf.underline) {
              el = <u>{el}</u>;
            }
            return el;
          }}
        />
      </Slate>
    </div>
  );
};

export default SlateEditor;
