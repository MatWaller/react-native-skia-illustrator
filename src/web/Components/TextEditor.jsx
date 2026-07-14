// MW - Modal form for placing or editing a text shape.

import React from 'react';
import { webStyles } from '../styles';

export const TextEditor = ({
  visible,
  mode,
  value,
  onChange,
  onSubmit,
  onCancel,
  props,
}) => {
  if (!visible) return null;
  return (
    <div style={{ ...webStyles.modalOverlay, ...(props?.overlayStyle ?? {}) }}>
      <div
        style={{ ...webStyles.modalBackdrop, ...(props?.backdropStyle ?? {}) }}
        onMouseDown={onCancel}
      />
      <form
        style={{ ...webStyles.modalCard, ...(props?.cardStyle ?? {}) }}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {props?.showHeader !== false && (
          <div
            style={{ ...webStyles.modalHeader, ...(props?.headerStyle ?? {}) }}
          >
            <span
              style={{
                ...webStyles.modalHeaderText,
                ...(props?.headerTextStyle ?? {}),
              }}
            >
              {mode === 'edit'
                ? (props?.editHeader ?? 'Edit text')
                : (props?.createHeader ?? 'Add text')}
            </span>
          </div>
        )}
        <label
          style={{ ...webStyles.modalTitle, ...(props?.titleStyle ?? {}) }}
        >
          {mode === 'edit'
            ? (props?.editTitle ?? 'Edit text')
            : (props?.createTitle ?? 'Add text')}
        </label>
        <textarea
          autoFocus={true}
          rows={props?.multiline === false ? 1 : 4}
          placeholder={props?.placeholder ?? 'Type something…'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...webStyles.textInput, ...(props?.inputStyle ?? {}) }}
        />
        <div
          style={{ ...webStyles.buttonRow, ...(props?.buttonRowStyle ?? {}) }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              ...webStyles.cancelButton,
              ...(props?.cancelButtonStyle ?? {}),
            }}
          >
            <span style={props?.cancelButtonTextStyle ?? undefined}>
              {props?.cancelLabel ?? 'Cancel'}
            </span>
          </button>
          <button
            type="submit"
            style={{
              ...webStyles.submitButton,
              ...(props?.submitButtonStyle ?? {}),
            }}
          >
            <span style={props?.submitButtonTextStyle ?? undefined}>
              {props?.submitLabel ?? 'Place'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default TextEditor;
