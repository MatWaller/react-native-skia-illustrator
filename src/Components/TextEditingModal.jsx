import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Keyboard,
  Platform,
  useWindowDimensions,
} from 'react-native';

import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import {
  faCheck,
  faCircleChevronLeft,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

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
  brandData,
  // MW - Styling overrides.
  overlayStyle,
  backdropStyle,
  cardStyle,
  modalContainerStyle,
  headerStyle,
  modalHeaderStyle,
  headerTextStyle,
  modalHeaderTextStyle,
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
  showHeader = true,
}) => {
  const inputRef = React.useRef(null);
  const { height: windowHeight } = useWindowDimensions();
  const MODAL_MARGIN = 20;

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

  if (!visible) return null;

  const header = mode === 'edit' ? editHeader : createHeader;
  const title = mode === 'edit' ? editTitle : createTitle;
  const primaryColour = brandData?.primarycolour ?? '#1f5f8b';
  const availableHeight = windowHeight - keyboardHeight - MODAL_MARGIN * 2;
  const modalMaxHeight = Math.min(
    windowHeight * 0.9,
    Math.max(0, availableHeight)
  );

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
        <View
          style={[
            styles.card,
            {
              borderColor: primaryColour,
              maxHeight: modalMaxHeight,
            },
            cardStyle,
            modalContainerStyle,
          ]}
        >
          {showHeader && header ? (
            <View
              style={[
                styles.header,
                {
                  backgroundColor: primaryColour,
                  borderColor: primaryColour,
                },
                headerStyle,
                modalHeaderStyle,
              ]}
            >
              <Pressable
                style={({ pressed }) => [
                  styles.headerIconButton,
                  pressed && styles.buttonPressed,
                ]}
                hitSlop={10}
                onPress={onCancel}
                accessibilityRole="button"
                accessibilityLabel="Close text editor"
                accessibilityHint="Closes text editor"
              >
                <FontAwesomeIcon
                  icon={faCircleChevronLeft}
                  size={30}
                  color="#ffffff"
                />
              </Pressable>
              <View style={styles.headerTitleWrap}>
                <Text
                  style={[
                    styles.headerText,
                    headerTextStyle,
                    modalHeaderTextStyle,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {header}
                </Text>
              </View>
            </View>
          ) : null}
          <View style={styles.body}>
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
              multiline={multiline}
              autoCapitalize="sentences"
              autoCorrect
              returnKeyType={multiline ? 'default' : 'done'}
              blurOnSubmit={!multiline}
              onSubmitEditing={multiline ? undefined : onSubmit}
              autoFocus={true}
            />
            <View style={[styles.buttonRow, buttonRowStyle]}>
              {cancelLabel ? (
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
                    <Text
                      style={[styles.cancelButtonText, cancelButtonTextStyle]}
                    >
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
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  styles.submitButton,
                  { backgroundColor: primaryColour },
                  submitButtonStyle,
                  pressed && styles.buttonPressed,
                ]}
                disabled={!value || value.trim().length === 0}
                onPress={onSubmit}
              >
                <View style={styles.buttonContent}>
                  <Text
                    style={[styles.submitButtonText, submitButtonTextStyle]}
                  >
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
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    zIndex: 1000,
    elevation: 1000,
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  avoider: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 0,
  },
  card: {
    width: '90%',
    maxHeight: '90%',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 0,
    margin: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 2,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderLeftWidth: 0,
    overflow: 'hidden',
  },
  header: {
    width: '100%',
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderTopRightRadius: 8,
    borderTopLeftRadius: 8,
    borderWidth: 2,
  },
  headerIconButton: {
    marginLeft: 10,
    marginRight: 10,
  },
  headerTitleWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  body: {
    padding: 20,
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonIcon: {
    marginLeft: 8,
    alignSelf: 'center',
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
    lineHeight: 18,
    fontWeight: '500',
  },
  submitButton: {
    backgroundColor: '#6366f1',
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '600',
  },
});

export default TextEditingModal;
