import React from 'react';
import {
  View,
  TextInput,
  TouchableWithoutFeedback,
  StyleSheet,
} from 'react-native';

// MW - Invisible TextInput overlay that captures keystrokes while a text shape
// is being edited. Positioned at the shape's screen-space baseline so the OS
// keyboard appears in the right place. Opacity 0 hides the system cursor;
// the Skia canvas shows the live glyph update instead.
const TextEditingOverlay = ({
  editingTextId,
  editingScreenPos,
  editingContent,
  onChangeText,
  onCommit,
}) => {
  if (editingTextId == null) return null;

  return (
    <>
      <TouchableWithoutFeedback onPress={onCommit}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>
      <TextInput
        autoFocus
        style={[
          styles.input,
          {
            left: editingScreenPos.x,
            top: editingScreenPos.y - editingScreenPos.fontSize,
            fontSize: editingScreenPos.fontSize,
            color: editingScreenPos.colour,
          },
        ]}
        value={editingContent}
        onChangeText={onChangeText}
        onBlur={onCommit}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={onCommit}
      />
    </>
  );
};

const styles = StyleSheet.create({
  input: {
    position: 'absolute',
    padding: 0,
    margin: 0,
    minWidth: 80,
    backgroundColor: 'transparent',
    opacity: 0,
  },
});

export default TextEditingOverlay;
