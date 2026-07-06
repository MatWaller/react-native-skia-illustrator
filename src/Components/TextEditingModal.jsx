import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Keyboard,
  Platform,
} from 'react-native';

import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faXmark } from '@fortawesome/free-solid-svg-icons';

// MW - Text entry overlay used both when placing a new text shape and when
// editing an existing one. Implemented as a plain absolutely-positioned
// overlay (NOT a React Native <Modal>) because this package is frequently
// consumed inside a host modal, and nesting RN modals causes focus/stacking
// bugs across platforms.
//
// Every visual piece is overridable through the `*Style` props plus the text
// label props, so consumers can fully theme it without forking the component.
const TextEditingModal = ({
  visible,
  value,
  mode = 'create', // 'create' | 'edit'
  onChangeText,
  onSubmit,
  onCancel,
  // MW - Styling overrides.
  overlayStyle,
  backdropStyle,
  cardStyle,
  headerStyle,
  headerTextStyle,
  titleStyle,
  inputStyle,
  buttonRowStyle,
  cancelButtonStyle,
  cancelButtonTextStyle,
  submitButtonStyle,
  submitButtonTextStyle,
  // MW - Text/label overrides.
  createHeader = 'Text',
  editHeader = 'Text',
  createTitle = 'Add text',
  editTitle = 'Edit text',
  placeholder = 'Enter text',
  cancelLabel = 'Cancel',
  submitLabel = 'Done',
  cancelIcon = faXmark,
  submitIcon = faCheck,
  placeholderTextColor = '#9aa0a6',
  multiline = false,
  autoFocus = true,
  showHeader = true,
}) => {
  const inputRef = React.useRef(null);

  // MW - Track the keyboard height so we can reserve that space at the bottom
  // of the overlay. The card then centers in the *visible* area above the
  // keyboard, guaranteeing it is never covered. This is more reliable than
  // <KeyboardAvoidingView>, whose `behavior` is effectively a no-op on Android
  // and depends on the host's windowSoftInputMode.
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);

  React.useEffect(() => {
    // MW - iOS reports frames via the `Will*` events (smoother, fires before
    // the animation); Android only reliably emits `DidShow`/`DidHide`.
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e) => {
      setKeyboardHeight(e?.endCoordinates?.height ?? 0);
    };
    const onHide = () => setKeyboardHeight(0);

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // MW - Reset the reserved space whenever the overlay is hidden so a stale
  // keyboard height never lingers into the next open.
  React.useEffect(() => {
    if (!visible) setKeyboardHeight(0);
  }, [visible]);

  // MW - Re-focus whenever the overlay becomes visible so the keyboard opens
  // immediately on both create and edit. autoFocus alone is unreliable when
  // the same instance is reused for consecutive edits.
  React.useEffect(() => {
    if (!visible || !autoFocus) return;
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [visible, autoFocus]);

  if (!visible) return null;

  const header = mode === 'edit' ? editHeader : createHeader;
  const title = mode === 'edit' ? editTitle : createTitle;

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
      pointerEvents="box-none"
    >
      {/* MW - Tapping the backdrop cancels (matches a typical dialog). */}
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
        onPress={onCancel}
      />
      <View
        style={[styles.avoider, { paddingBottom: keyboardHeight }]}
        pointerEvents="box-none"
      >
        <View style={[styles.card, cardStyle]}>
          {showHeader && header ? (
            <View style={[styles.header, headerStyle]}>
              <Text style={[styles.headerText, headerTextStyle]}>{header}</Text>
            </View>
          ) : null}
          {title ? (
            <Text style={[styles.title, titleStyle]}>{title}</Text>
          ) : null}
          <TextInput
            ref={inputRef}
            style={[
              styles.input,
              multiline && styles.inputMultiline,
              inputStyle,
            ]}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={placeholderTextColor}
            autoFocus={autoFocus}
            multiline={multiline}
            autoCapitalize="sentences"
            autoCorrect
            returnKeyType={multiline ? 'default' : 'done'}
            blurOnSubmit={!multiline}
            onSubmitEditing={multiline ? undefined : onSubmit}
          />
          <View style={[styles.buttonRow, buttonRowStyle]}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.cancelButton,
                cancelButtonStyle,
                pressed && styles.buttonPressed,
              ]}
              onPress={onCancel}
            >
              <View style={styles.buttonContent}>
                <Text style={[styles.cancelButtonText, cancelButtonTextStyle]}>
                  {cancelLabel}
                </Text>
                {cancelIcon ? (
                  <FontAwesomeIcon
                    icon={cancelIcon}
                    size={13}
                    color="#3c4043"
                    style={styles.buttonIcon}
                  />
                ) : null}
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.submitButton,
                submitButtonStyle,
                pressed && styles.buttonPressed,
              ]}
              onPress={onSubmit}
            >
              <View style={styles.buttonContent}>
                <Text style={[styles.submitButtonText, submitButtonTextStyle]}>
                  {submitLabel}
                </Text>
                {submitIcon ? (
                  <FontAwesomeIcon
                    icon={submitIcon}
                    size={13}
                    color="#ffffff"
                    style={styles.buttonIcon}
                  />
                ) : null}
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    zIndex: 1000,
    elevation: 1000,
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  avoider: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  header: {
    marginHorizontal: -20,
    marginTop: -20,
    marginBottom: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ececf0',
    backgroundColor: '#f6f6f8',
  },
  headerText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1f1f1f',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f1f1f',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d0d3d8',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111111',
    backgroundColor: '#fafafa',
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  button: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    marginLeft: 10,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonIcon: {
    marginLeft: 8,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  cancelButton: {
    backgroundColor: '#eceef1',
  },
  cancelButtonText: {
    color: '#3c4043',
    fontSize: 15,
    fontWeight: '500',
  },
  submitButton: {
    backgroundColor: '#6366f1',
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default TextEditingModal;
