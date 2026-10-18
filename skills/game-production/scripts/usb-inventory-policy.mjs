export function summarizeUsb(raw, adbStates) {
  if (
    raw?.schemaVersion !== 1 ||
    raw.scope !== 'present-windows-usb-interfaces' ||
    raw.identifiersRedacted !== true ||
    raw.readOnly !== true ||
    !Array.isArray(raw.interfaces) ||
    raw.interfaces.length > 64 ||
    !Number.isSafeInteger(raw.groupingUnavailable) ||
    raw.groupingUnavailable < 0 ||
    !Array.isArray(adbStates) ||
    adbStates.length > 32
  )
    throw Error('Incomplete read-only USB inventory');
  const groups = new Map();
  const interfaces = raw.interfaces.map((row) => {
    if (
      !['ADB', 'MTP', 'AndroidCandidate', 'USBError'].includes(row?.interface) ||
      !['OK', 'ERROR', 'DEGRADED', 'UNKNOWN'].includes(row.status) ||
      (row.group !== null && !/^usb-group-[1-9][0-9]{0,2}$/.test(row.group || ''))
    )
      throw Error('Unexpected USB diagnostic value');
    if (row.group) {
      const entry = groups.get(row.group) || new Set();
      entry.add(row.interface);
      groups.set(row.group, entry);
    }
    return { group: row.group, interface: row.interface, status: row.status };
  });
  if (adbStates.some((state) => !['device', 'unauthorized', 'offline'].includes(state)))
    throw Error('Unknown ADB state');
  return {
    status: 'observed_not_second_phone_certification',
    readOnly: true,
    adbUsb: {
      ready: adbStates.filter((s) => s === 'device').length,
      unauthorized: adbStates.filter((s) => s === 'unauthorized').length,
      offline: adbStates.filter((s) => s === 'offline').length
    },
    interfaces,
    containerGroups: [...groups].map(([alias, kinds]) => ({ alias, interfaces: [...kinds] })),
    groupingUnavailable: raw.groupingUnavailable,
    identifiersRedacted: true,
    secondPhoneConfirmed: false,
    note: 'One phone can expose multiple interfaces. Container groups are diagnostic candidates, not proof of two authorized Android phones. No drivers, permissions or USB mode were changed.'
  };
}
