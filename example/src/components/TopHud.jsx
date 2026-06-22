import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import { STATUS_BAR_H } from '../constants';

export function TopHud({
  activeMeta,
  activeTool,
  onSave,
  onClear,
  onDeleteSelectedShape,
  hasSelectedShape,
  topInset,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canDeleteSelectedShape =
    hasSelectedShape &&
    (activeTool === 'shape' ||
      activeTool === 'text' ||
      activeTool === 'control');
  const hasToolOptions = canDeleteSelectedShape;
  const toolOptionsExpanded = hasToolOptions && isExpanded;
  const showDeleteOption = toolOptionsExpanded && canDeleteSelectedShape;

  useEffect(() => {
    setIsExpanded(false);
  }, [activeTool]);

  return (
    <View
      style={[styles.topHud, { top: topInset + 8 }]}
      pointerEvents="box-none"
    >
      <View style={styles.toolArea} pointerEvents="box-none">
        <TouchableOpacity
          style={[
            styles.toolPill,
            toolOptionsExpanded && styles.toolPillExpanded,
          ]}
          onPress={() => setIsExpanded((expanded) => !expanded)}
          activeOpacity={0.82}
          disabled={!hasToolOptions}
          pointerEvents="auto"
        >
          {activeMeta?.icon && (
            <FontAwesomeIcon icon={activeMeta.icon} size={13} color="#fff" />
          )}
          <Text style={styles.toolPillText}>{activeMeta?.label}</Text>
          {hasToolOptions && (
            <FontAwesomeIcon
              icon={isExpanded ? faChevronUp : faChevronDown}
              size={11}
              color="rgba(255,255,255,0.75)"
            />
          )}
        </TouchableOpacity>
        {showDeleteOption && (
          <View style={styles.optionsPanel} pointerEvents="auto">
            <View style={styles.deleteRow}>
              <TouchableOpacity
                style={[styles.modePill, styles.clearBtn]}
                onPress={onDeleteSelectedShape}
              >
                <Text style={styles.btnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.actionColumn} pointerEvents="auto">
        <TouchableOpacity style={styles.saveBtn} onPress={onSave}>
          <Text style={styles.btnText}>Save Image</Text>
        </TouchableOpacity>
        <View style={styles.actionSpacer} />
        <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
          <Text style={styles.btnText}>Clear Canvas</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topHud: {
    position: 'absolute',
    top: STATUS_BAR_H + 8,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  toolArea: {
    alignItems: 'flex-start',
    maxWidth: '72%',
  },
  toolPill: {
    backgroundColor: 'rgba(15,15,20,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolPillExpanded: {
    backgroundColor: 'rgba(15,15,20,0.82)',
  },
  toolPillText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  optionsPanel: {
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
    backgroundColor: 'rgba(15,15,20,0.72)',
    borderRadius: 18,
    padding: 8,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  deleteRow: {
    alignItems: 'flex-start',
    width: '100%',
  },
  modePill: {
    backgroundColor: 'rgba(15,15,20,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modePillActive: {
    backgroundColor: 'rgba(99,102,241,0.8)',
  },
  modePillText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  modePillTextActive: {
    color: '#fff',
  },
  actionColumn: {
    alignItems: 'stretch',
  },
  actionSpacer: {
    height: 10,
    width: 8,
  },
  clearBtn: {
    backgroundColor: 'rgba(239,68,68,0.88)',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  saveBtn: {
    backgroundColor: 'rgba(59,130,246,0.88)',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
