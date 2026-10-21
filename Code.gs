const SPREADSHEET_ID = '1bK_remWm6O5Jj4p37stkf4vCi3jV0p4zyh5U2wiM-QU';

const TABLES = {
  transactions: {
    name: 'FT Transactions',
    headers: ['id', 'createdAt', 'updatedAt', 'type', 'member', 'amount', 'date', 'purpose', 'recordedBy', 'customFields', 'status', 'monitorId']
  },
  fields: {
    name: 'FT Form Fields',
    headers: ['id', 'label', 'type', 'required', 'options', 'active', 'createdAt']
  },
  monitors: {
    name: 'FT Monitors',
    headers: ['id', 'name', 'dates', 'createdAt', 'status']
  },
  members: {
    name: 'FT Monitor Members',
    headers: ['id', 'monitorId', 'name', 'createdAt', 'status']
  },
  profiles: {
    name: 'FT Member Profiles',
    headers: ['name', 'plakaso', 'updatedAt']
  },
  values: {
    name: 'FT Monitor Values',
    headers: ['id', 'monitorId', 'memberId', 'date', 'value', 'updatedAt']
  },
  audit: {
    name: 'FT Audit Logs',
    headers: ['timestamp', 'actor', 'action', 'entity', 'entityId', 'details']
  }
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('KEV')
    .setTitle('Live Funds Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(event) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    const request = JSON.parse(event && event.postData ? event.postData.contents : '{}');
    const methods = Object.assign(Object.create(null), {
      getAppData: getAppData,
      getBranding: getBranding,
      saveFormField: saveFormField,
      archiveFormField: archiveFormField,
      saveTransaction: saveTransaction,
      voidTransaction: voidTransaction,
      createMonitoring: createMonitoring,
      addMonitoringDate: addMonitoringDate,
      addMonitoringMember: addMonitoringMember,
      archiveMonitoring: archiveMonitoring
    });
    const method = methods[request.method];
    if (!method) throw new Error('Unsupported tracker operation.');
    const args = Array.isArray(request.args) ? request.args : [];
    return output.setContent(JSON.stringify({ result: method.apply(null, args) }));
  } catch (error) {
    return output.setContent(JSON.stringify({
      error: error && error.message ? error.message : 'The tracker request failed.'
    }));
  }
}

function getAppData() {
  ensureTables_();
  const monitorRows = getRows_('monitors').filter(row => row.status !== 'ARCHIVED');
  const defaultMonitorId = monitorRows.length ? String(monitorRows[0].id) : '';
  const transactions = getRows_('transactions')
    .filter(row => row.status !== 'VOID')
    .map(row => {
      const transaction = transactionToClient_(row);
      if (transaction.type === 'DEDUCT') {
        transaction.member = '';
      }
      // Older transactions predate monitoring selection; place them in the first active monitoring.
      if (!transaction.monitorId) transaction.monitorId = defaultMonitorId;
      return transaction;
    });
  const availableFunds = roundMoney_(transactions.reduce((balance, transaction) =>
    balance + (transaction.type === 'ADD' ? transaction.amount : -transaction.amount), 0));
  const fields = getRows_('fields')
    .filter(row => row.active === true || String(row.active).toLowerCase() === 'true')
    .map(row => ({
      id: String(row.id),
      label: String(row.label),
      type: String(row.type),
      required: row.required === true || String(row.required).toLowerCase() === 'true',
      options: String(row.options || '').split('\n').filter(Boolean)
    }));
  const plakasoByMemberName = new Map(getRows_('profiles')
    .map(profile => [String(profile.name).trim().toLowerCase(), String(profile.plakaso || '')]));
  const monitors = monitorRows.map(row => {
      const monitorId = String(row.id);
      const dates = new Set(parseJson_(row.dates, []));
      const monitorMemberRows = getRows_('members')
        .filter(member => String(member.monitorId) === monitorId);
      const archivedMemberNames = new Set(monitorMemberRows
        .filter(member => member.status === 'ARCHIVED')
        .map(member => String(member.name).trim().toLowerCase()));
      const storedMembers = monitorMemberRows
        .filter(member => member.status !== 'ARCHIVED')
        .map(member => {
          const name = String(member.name);
          return {
            id: String(member.id),
            name: name,
            plakaso: plakasoByMemberName.get(name.trim().toLowerCase()) || ''
          };
        });
      const membersByName = new Map(storedMembers.map(member => [member.name.toLowerCase(), {
        id: member.id, name: member.name, plakaso: member.plakaso, values: {}
      }]));
      const contributionsByDate = {};
      transactions.filter(transaction => transaction.monitorId === monitorId).forEach(transaction => {
        dates.add(transaction.date);
        if (transaction.type !== 'ADD') return;
        const key = transaction.member.toLowerCase();
        contributionsByDate[transaction.date] = roundMoney_(
          Number(contributionsByDate[transaction.date] || 0) + transaction.amount
        );
        if (!membersByName.has(key)) {
          if (archivedMemberNames.has(key)) return;
          membersByName.set(key, {
            id: 'transaction-member:' + key,
            name: transaction.member,
            plakaso: plakasoByMemberName.get(key) || '',
            values: {}
          });
        }
        const member = membersByName.get(key);
        const current = Number(member.values[transaction.date] || 0);
        member.values[transaction.date] = Math.round((current + transaction.amount) * 100) / 100;
      });
      membersByName.forEach(member => {
        member.total = roundMoney_(Array.from(dates).reduce((sum, date) => sum + Number(member.values[date] || 0), 0));
      });
      const deductionsByDate = {};
      dates.forEach(date => {
        deductionsByDate[date] = roundMoney_(transactions
          .filter(transaction => transaction.type === 'DEDUCT' && transaction.monitorId === monitorId && transaction.date === date)
          .reduce((sum, transaction) => sum + transaction.amount, 0));
      });
      const totals = {};
      dates.forEach(date => {
        totals[date] = roundMoney_(Number(contributionsByDate[date] || 0) - deductionsByDate[date]);
      });
      return {
        id: monitorId,
        name: String(row.name),
        dates: Array.from(dates).sort(),
        members: Array.from(membersByName.values()),
        deductionsByDate: deductionsByDate,
        deductionTotal: roundMoney_(Object.keys(deductionsByDate).reduce((sum, date) => sum + deductionsByDate[date], 0)),
        totals: totals,
        total: roundMoney_(Array.from(dates).reduce((sum, date) => sum + totals[date], 0))
      };
    });

  const audit = getRows_('audit').reverse().map(row => ({
    timestamp: dateTimeToClient_(row.timestamp),
    actor: String(row.actor || ''),
    action: String(row.action || ''),
    entity: String(row.entity || ''),
    entityId: String(row.entityId || ''),
    details: String(row.details || '')
  }));

  return {
    fields: fields,
    transactions: transactions.reverse(),
    monitors: monitors,
    audit: audit,
    availableFunds: availableFunds,
    actor: 'Public user'
  };
}

function getBranding() {
  return getBranding_();
}

function saveFormField(field) {
  ensureTables_();
  const label = cleanText_(field && field.label, 100);
  const type = String(field && field.type || '');
  const allowedTypes = ['text', 'number', 'date', 'select'];
  if (!label) throw new Error('Enter a field name.');
  if (allowedTypes.indexOf(type) === -1) throw new Error('Choose a supported field type.');
  const options = type === 'select'
    ? String(field.options || '').split(/\r?\n/).map(value => cleanText_(value, 100)).filter(Boolean)
    : [];
  if (type === 'select' && !options.length) throw new Error('Add at least one option for a dropdown field.');

  const sheet = getSheet_('fields');
  const existing = field.id ? findRow_('fields', 'id', String(field.id)) : null;
  if (existing) {
    const row = existing.values;
    row[1] = label;
    row[2] = type;
    row[3] = Boolean(field.required);
    row[4] = options.join('\n');
    sheet.getRange(existing.rowNumber, 1, 1, TABLES.fields.headers.length).setValues([row]);
    audit_('Updated form field', 'Form field', String(field.id), label);
  } else {
    const id = Utilities.getUuid();
    sheet.appendRow([id, label, type, Boolean(field.required), options.join('\n'), true, new Date()]);
    audit_('Added form field', 'Form field', id, label);
  }
  return getAppData();
}

function archiveFormField(fieldId) {
  ensureTables_();
  const found = findRow_('fields', 'id', String(fieldId || ''));
  if (!found) throw new Error('That form field no longer exists.');
  found.values[5] = false;
  getSheet_('fields').getRange(found.rowNumber, 1, 1, TABLES.fields.headers.length).setValues([found.values]);
  audit_('Removed form field', 'Form field', String(fieldId), String(found.values[1]));
  return getAppData();
}

function saveTransaction(payload) {
  return withTrackerLock_(() => saveTransactionLocked_(payload));
}

function saveTransactionLocked_(payload) {
  ensureTables_();
  if (!payload || !['ADD', 'DEDUCT'].includes(String(payload.type))) throw new Error('Choose an addition or deduction.');
  const member = String(payload.type) === 'ADD' ? cleanText_(payload.member, 120) : '';
  const purpose = cleanText_(payload.purpose, 500);
  const date = validDate_(payload.date);
  const enteredAmount = Number(payload.amount);
  const amount = Math.round(enteredAmount * 100) / 100;
  const recordedBy = cleanText_(payload.recordedBy, 120) || getActor_();
  if (String(payload.type) === 'ADD' && !member) throw new Error('Enter a member name.');
  if (!Number.isFinite(enteredAmount) || enteredAmount <= 0) throw new Error('Amount must be greater than zero.');
  if (Math.abs(enteredAmount - amount) > 0.0000001) throw new Error('Amount can have no more than two decimal places.');
  if (!date) throw new Error('Choose a valid transaction date.');
  const activeMonitors = getRows_('monitors').filter(row => row.status !== 'ARCHIVED');
  const monitorId = cleanText_(payload.monitorId, 100);
  if (activeMonitors.length && !monitorId) throw new Error('Choose a monitoring form for this transaction.');
  if (monitorId && !activeMonitors.some(row => String(row.id) === monitorId)) {
    throw new Error('Choose an active monitoring form.');
  }

  const custom = {};
  const fieldById = {};
  getRows_('fields').filter(row => row.active === true || String(row.active).toLowerCase() === 'true')
    .forEach(row => { fieldById[String(row.id)] = row; });
  Object.keys(payload.customFields || {}).forEach(id => {
    const field = fieldById[id];
    if (!field) return;
    if (String(payload.type) === 'DEDUCT' && String(field.label).trim().toLowerCase() === 'member') return;
    let value = cleanText_(payload.customFields[id], 500);
    if (Boolean(field.required) && !value) throw new Error('"' + field.label + '" is required.');
    if (field.type === 'select' && value && String(field.options).split('\n').indexOf(value) === -1) {
      throw new Error('Choose a valid option for "' + field.label + '".');
    }
    if (field.type === 'number' && value && !Number.isFinite(Number(value))) {
      throw new Error('"' + field.label + '" must be a number.');
    }
    if (field.type === 'date' && value && !validDate_(value)) {
      throw new Error('"' + field.label + '" must be a valid date.');
    }
    custom[id] = value;
  });
  Object.keys(fieldById).forEach(id => {
    const field = fieldById[id];
    if (String(payload.type) === 'DEDUCT' && String(field.label).trim().toLowerCase() === 'member') return;
    if (Boolean(field.required) && !custom[id]) throw new Error('"' + field.label + '" is required.');
  });

  const sheet = getSheet_('transactions');
  const existing = payload.id ? findRow_('transactions', 'id', String(payload.id)) : null;
  if (payload.id && (!existing || existing.values[10] === 'VOID')) throw new Error('That transaction is no longer available.');
  const id = existing ? String(payload.id) : Utilities.getUuid();
  const createdAt = existing ? existing.values[1] : new Date();
  const prior = existing ? transactionToClient_(rowToObject_(TABLES.transactions.headers, existing.values)) : null;
  const candidate = {
    id: id,
    createdAt: createdAt,
    updatedAt: new Date(),
    type: String(payload.type),
    member: member,
    amount: amount,
    date: date,
    purpose: purpose,
    recordedBy: recordedBy,
    customFields: JSON.stringify(custom),
    status: 'ACTIVE',
    monitorId: monitorId
  };
  const priorTransactions = getRows_('transactions')
    .filter(row => row.status !== 'VOID' && (!existing || String(row.id) !== id))
    .map(row => {
      const transaction = transactionToClient_(row);
      if (!transaction.monitorId && activeMonitors.length) transaction.monitorId = String(activeMonitors[0].id);
      return transaction;
    });
  const monitoredBalance = roundMoney_(priorTransactions
    .filter(transaction => transaction.monitorId === monitorId)
    .reduce((balance, transaction) => balance + (transaction.type === 'ADD' ? transaction.amount : -transaction.amount), 0));
  if (candidate.type === 'DEDUCT' && amount > monitoredBalance) {
    throw new Error('This deduction exceeds available funds in the selected monitoring (' + formatAmount_(monitoredBalance) + ').');
  }

  if (candidate.type === 'ADD') ensureMonitoringDimensions_(monitorId, member, date);
  else if (monitorId) ensureMonitoringDate_(monitorId, date);

  const values = [
    candidate.id, candidate.createdAt, candidate.updatedAt, candidate.type, candidate.member,
    candidate.amount, candidate.date, candidate.purpose, candidate.recordedBy, candidate.customFields, candidate.status,
    candidate.monitorId
  ];
  if (existing) {
    sheet.getRange(existing.rowNumber, 1, 1, TABLES.transactions.headers.length).setValues([values]);
    audit_('Updated transaction', 'Transaction', id, JSON.stringify({ before: prior, after: transactionToClient_(candidate) }));
  } else {
    sheet.appendRow(values);
    audit_(candidate.type === 'ADD' ? 'Added funds' : 'Deducted funds', 'Transaction', id,
      JSON.stringify({ member: member || 'All funds', amount: amount, date: date, purpose: purpose, monitorId: monitorId }));
  }
  return getAppData();
}

function voidTransaction(transactionId) {
  return withTrackerLock_(() => voidTransactionLocked_(transactionId));
}

function voidTransactionLocked_(transactionId) {
  ensureTables_();
  const found = findRow_('transactions', 'id', String(transactionId || ''));
  if (!found || found.values[10] === 'VOID') throw new Error('That transaction is no longer available.');
  found.values[10] = 'VOID';
  found.values[2] = new Date();
  getSheet_('transactions').getRange(found.rowNumber, 1, 1, TABLES.transactions.headers.length).setValues([found.values]);
  audit_('Voided transaction', 'Transaction', String(transactionId),
    JSON.stringify({ member: found.values[3] === 'DEDUCT' ? 'All funds' : found.values[4], type: found.values[3], amount: found.values[5] }));
  return getAppData();
}

function createMonitoring(name) {
  ensureTables_();
  const cleanName = cleanText_(name, 100);
  if (!cleanName) throw new Error('Enter a monitoring name.');
  const id = Utilities.getUuid();
  getSheet_('monitors').appendRow([id, cleanName, '[]', new Date(), 'ACTIVE']);
  audit_('Created monitoring', 'Monitoring', id, cleanName);
  return getAppData();
}

function addMonitoringDate(monitorId, dateValue) {
  ensureTables_();
  const date = validDate_(dateValue);
  if (!date) throw new Error('Choose a valid date for the new column.');
  const found = findRow_('monitors', 'id', String(monitorId || ''));
  if (!found || found.values[4] === 'ARCHIVED') throw new Error('That monitoring form no longer exists.');
  const dates = parseJson_(found.values[2], []);
  if (dates.indexOf(date) !== -1) throw new Error('That date column already exists.');
  dates.push(date);
  dates.sort();
  found.values[2] = JSON.stringify(dates);
  getSheet_('monitors').getRange(found.rowNumber, 1, 1, TABLES.monitors.headers.length).setValues([found.values]);
  audit_('Added monitoring date column', 'Monitoring', String(monitorId), date);
  return getAppData();
}

function addMonitoringMember(monitorId, memberName) {
  ensureTables_();
  const monitor = findRow_('monitors', 'id', String(monitorId || ''));
  if (!monitor || monitor.values[4] === 'ARCHIVED') throw new Error('That monitoring form no longer exists.');
  const name = cleanText_(memberName, 120);
  if (!name) throw new Error('Enter a member name.');
  const duplicate = getRows_('members').some(row =>
    String(row.monitorId) === String(monitorId) && row.status !== 'ARCHIVED' &&
    String(row.name).toLowerCase() === name.toLowerCase());
  if (duplicate) throw new Error('That member is already in this monitoring.');
  const id = Utilities.getUuid();
  getSheet_('members').appendRow([id, String(monitorId), name, new Date(), 'ACTIVE']);
  audit_('Added monitoring member', 'Monitoring member', id, name);
  return getAppData();
}

function ensureMonitoringDimensions_(monitorId, memberName, date) {
  const monitor = findRow_('monitors', 'id', monitorId);
  if (!monitor || monitor.values[4] === 'ARCHIVED') throw new Error('That monitoring form is no longer available.');

  const members = getRows_('members');
  const existingMember = members.find(row =>
    String(row.monitorId) === monitorId &&
    row.status !== 'ARCHIVED' &&
    String(row.name).toLowerCase() === memberName.toLowerCase());
  if (!existingMember) {
    getSheet_('members').appendRow([Utilities.getUuid(), monitorId, memberName, new Date(), 'ACTIVE']);
  }

  ensureMonitoringDate_(monitorId, date);
}

function ensureMonitoringDate_(monitorId, date) {
  const monitor = findRow_('monitors', 'id', monitorId);
  if (!monitor || monitor.values[4] === 'ARCHIVED') throw new Error('That monitoring form is no longer available.');
  const dates = parseJson_(monitor.values[2], []);
  if (dates.indexOf(date) === -1) {
    dates.push(date);
    dates.sort();
    monitor.values[2] = JSON.stringify(dates);
    getSheet_('monitors').getRange(monitor.rowNumber, 1, 1, TABLES.monitors.headers.length).setValues([monitor.values]);
  }
}

function archiveMonitoring(monitorId) {
  ensureTables_();
  const found = findRow_('monitors', 'id', String(monitorId || ''));
  if (!found || found.values[4] === 'ARCHIVED') throw new Error('That monitoring form no longer exists.');
  found.values[4] = 'ARCHIVED';
  getSheet_('monitors').getRange(found.rowNumber, 1, 1, TABLES.monitors.headers.length).setValues([found.values]);
  audit_('Archived monitoring', 'Monitoring', String(monitorId), String(found.values[1]));
  return getAppData();
}

function ensureTables_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.keys(TABLES).forEach(key => {
    const definition = TABLES[key];
    let sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) sheet = spreadsheet.insertSheet(definition.name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
      sheet.setFrozenRows(1);
    } else {
      const headers = sheet.getRange(1, 1, 1, definition.headers.length).getDisplayValues()[0];
      const transactionHeadersBeforeMonitoring = [
        'id', 'createdAt', 'updatedAt', 'type', 'member', 'amount', 'date',
        'purpose', 'recordedBy', 'customFields', 'status'
      ];
      if (key === 'transactions' &&
          transactionHeadersBeforeMonitoring.every((header, index) => headers[index] === header)) {
        sheet.getRange(1, definition.headers.length).setValue('monitorId');
        return;
      }
      if (definition.headers.some((header, index) => headers[index] !== header)) {
        throw new Error('The "' + definition.name + '" tab exists but its headers do not match the tracker. Rename the conflicting tab or restore its expected headers.');
      }
    }
  });
}

function getSheet_(key) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(TABLES[key].name);
}

function getRows_(key) {
  const definition = TABLES[key];
  const sheet = getSheet_(key);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, definition.headers.length).getValues()
    .map(values => rowToObject_(definition.headers, values));
}

function rowToObject_(headers, values) {
  const result = {};
  headers.forEach((header, index) => { result[header] = values[index]; });
  return result;
}

function findRow_(key, header, value) {
  const definition = TABLES[key];
  const columnIndex = definition.headers.indexOf(header);
  if (columnIndex < 0) throw new Error('Invalid table lookup.');
  const sheet = getSheet_(key);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, definition.headers.length).getValues();
  for (let index = 0; index < values.length; index++) {
    if (String(values[index][columnIndex]) === String(value)) {
      return { rowNumber: index + 2, values: values[index] };
    }
  }
  return null;
}

function transactionToClient_(row) {
  return {
    id: String(row.id),
    createdAt: dateTimeToClient_(row.createdAt),
    type: String(row.type),
    member: String(row.member),
    amount: Number(row.amount),
    date: validDate_(row.date) || '',
    purpose: String(row.purpose || ''),
    recordedBy: String(row.recordedBy || ''),
    customFields: parseJson_(row.customFields, {}),
    monitorId: String(row.monitorId || '')
  };
}

function audit_(action, entity, entityId, details) {
  getSheet_('audit').appendRow([new Date(), getActor_(), action, entity, entityId, String(details || '')]);
}

function withTrackerLock_(operation) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return operation();
  } finally {
    lock.releaseLock();
  }
}

function getActor_() {
  return 'Public user';
}

function getBranding_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName('Images');
  if (!sheet) return { logo: '', error: 'Create an "Images" sheet and place the logo image in B2.' };
  const errors = [];
  let logo = '';
  try {
    logo = getImageDataUri_(sheet, 'B2');
  } catch (error) {
    errors.push('Logo (Images!B2): ' + error.message);
  }
  if (!logo && !errors.some(error => error.indexOf('Logo (Images!B2):') === 0)) {
    errors.push('Add the logo image to Images!B2.');
  }
  return {
    logo: logo,
    error: errors.join(' ')
  };
}

function getImageDataUri_(sheet, cellAddress) {
  const cell = sheet.getRange(cellAddress);
  const anchorRow = cell.getRow();
  const anchorColumn = cell.getColumn();
  const anchoredImage = sheet.getImages().find(image => {
    const anchor = image.getAnchorCell();
    return anchor.getRow() === anchorRow && anchor.getColumn() === anchorColumn;
  });
  if (anchoredImage) return blobToDataUri_(anchoredImage.getBlob());

  const richText = cell.getRichTextValue();
  const richTextUrl = richText && richText.getLinkUrl ? richText.getLinkUrl() : '';
  const formula = cell.getFormula();
  const hyperlinkFormula = formula && formula.match(/^=HYPERLINK\(\s*"([^"]+)"/i);
  const linkedUrl = richTextUrl || (hyperlinkFormula && hyperlinkFormula[1]);
  if (linkedUrl) {
    const driveFileId = driveFileIdFromUrl_(linkedUrl);
    if (driveFileId) return blobToDataUri_(DriveApp.getFileById(driveFileId).getBlob());
    return blobToDataUri_(fetchImageBlob_(linkedUrl));
  }

  const imageFormula = formula && formula.match(/^=IMAGE\(\s*"([^"]+)"/i);
  if (imageFormula) {
    const driveFileId = driveFileIdFromUrl_(imageFormula[1]);
    if (driveFileId) return blobToDataUri_(DriveApp.getFileById(driveFileId).getBlob());
    return blobToDataUri_(fetchImageBlob_(imageFormula[1]));
  }

  const value = cell.getValue();
  if (value && typeof value.getContentUrl === 'function') {
    const imageUrl = value.getContentUrl();
    if (!imageUrl) return '';
    return blobToDataUri_(fetchImageBlob_(imageUrl));
  }
  if (typeof value === 'string' && value.trim()) {
    const url = value.trim();
    if (/^data:image\//i.test(url)) return url;
    const driveFileId = driveFileIdFromUrl_(url);
    if (driveFileId) return blobToDataUri_(DriveApp.getFileById(driveFileId).getBlob());
    return blobToDataUri_(fetchImageBlob_(url));
  }
  return '';
}

function driveFileIdFromUrl_(url) {
  const value = String(url || '').trim();
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/uc\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/open\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/(?:uc|document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/i
  ];
  for (let index = 0; index < patterns.length; index++) {
    const match = value.match(patterns[index]);
    if (match) return match[1];
  }
  return '';
}

function fetchImageBlob_(url) {
  const parsedUrl = String(url || '').match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/i);
  if (!parsedUrl) throw new Error('Images must be stored as inserted images or HTTPS image URLs.');
  const host = parsedUrl[1].toLowerCase();
  const isGoogleImageHost = host === 'googleusercontent.com' ||
    host.endsWith('.googleusercontent.com') ||
    host === 'google.com' ||
    host.endsWith('.google.com') ||
    host === 'googleapis.com' ||
    host.endsWith('.googleapis.com');
  let response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200 && isGoogleImageHost) {
    response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
  }
  if (response.getResponseCode() !== 200) {
    throw new Error('Could not load image from ' + url + ' (HTTP ' + response.getResponseCode() + '). Make sure the image is accessible to the Apps Script deployment account.');
  }
  return response.getBlob();
}

function blobToDataUri_(blob) {
  const contentType = blob.getContentType();
  if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/i.test(contentType)) {
    throw new Error('Branding cells must contain supported image types (PNG, JPEG, GIF, WebP, or SVG).');
  }
  return 'data:' + contentType + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function cleanText_(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function validDate_(value) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const text = String(value == null ? '' : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(text + 'T00:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return '';
  return text;
}

function dateTimeToClient_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function parseJson_(value, fallback) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error('Tracker data contains invalid JSON. Check the FT tabs in the spreadsheet and correct the malformed value.');
  }
}

function formatAmount_(value) {
  return roundMoney_(Number(value || 0)).toFixed(2);
}

function roundMoney_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
