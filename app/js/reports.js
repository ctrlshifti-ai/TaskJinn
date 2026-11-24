// Builds the timesheet and invoice spreadsheets (.xlsx) and saves them in the organization's
// folder (Timesheets/ and Invoices/). The layout follows a typical contractor timesheet and
// invoice. Rows and columns below are counted from 0 (row 0 = spreadsheet row 1).

import { api } from './api.js';
import * as u from './util.js';
import { FREQUENCIES, dateKey, periodDescription, periodSummary, saveSettings, signaturePath } from './billing.js';

const DATE_FORMAT = 'dd/mm/yyyy';

/** Turns text into a safe file-name part: "Jane Doe" → "Jane_Doe". */
const fileName = (text) => text.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Spreadsheet column letter for a 0-based column number (0 → "A"). */
const letter = (col) => String.fromCharCode(65 + col);

/** Small helper to collect cells, merges and row heights while laying out a sheet. */
function newSheet(name, styles, columns) {
  // Every style uses Arial unless it says otherwise.
  const withFont = Object.fromEntries(Object.entries(styles).map(([key, style]) => [key, { font: 'Arial', ...style }]));
  const sheet = {
    name, styles: withFont, hideGridlines: true,
    columns: columns.map((width, col) => ({ col, width })), rows: [], cells: [], merges: [], images: [],
  };
  return {
    sheet,
    cell: (row, col, value, style) => {
      const cell = { row, col, style };
      if (typeof value === 'number') cell.number = value;
      else if (value instanceof Date) cell.date = dateKey(value);
      else if (typeof value === 'string' && value.startsWith('=')) cell.formula = value;
      else if (value !== undefined && value !== null) cell.text = String(value);
      sheet.cells.push(cell);
      return cell;
    },
    merge: (firstRow, firstCol, lastRow, lastCol, text, style) =>
      sheet.merges.push({ firstRow, firstCol, lastRow, lastCol, text: text ?? '', style }),
    height: (row, height) => sheet.rows.push({ row, height }),
  };
}

async function saveSheet(org, folderName, name, sheet) {
  const folder = u.joinPath(org.folderPath, folderName);
  await api.makeDir(folder);
  const path = u.joinPath(folder, `${name}.xlsx`);
  await api.writeXlsx(path, sheet);
  return path;
}

// ======================================================================
// Timesheet
// ======================================================================

const TIMESHEET_STYLES = {
  company: { size: 16, color: '#333333', borderBottom: true, borderColor: '#7A6A58' },
  subtitle: { size: 11, color: '#7A6A58', italic: true },
  label: { border: true, borderColor: '#7A6A58' },
  value: { border: true, borderColor: '#7A6A58', align: 'right' },
  valueDate: { border: true, borderColor: '#7A6A58', align: 'right', numberFormat: DATE_FORMAT },
  header: { bold: true, color: '#FFFFFF', background: '#7A6A58', align: 'center', border: true, borderColor: '#FFFFFF' },
  headerNumber: { bold: true, color: '#FFFFFF', background: '#7A6A58', align: 'right', border: true, borderColor: '#FFFFFF', numberFormat: '0.00' },
  weekday: { bold: true, background: '#D5DEE2', border: true, borderColor: '#FFFFFF' },
  weekend: { background: '#E8EEF0', border: true, borderColor: '#FFFFFF' },
  weekdayDate: { bold: true, background: '#E8EEF0', border: true, borderColor: '#FFFFFF', align: 'right', numberFormat: DATE_FORMAT },
  weekendDate: { background: '#E8EEF0', border: true, borderColor: '#FFFFFF', align: 'right', numberFormat: DATE_FORMAT },
  weekdayHours: { bold: true, background: '#E8EEF0', border: true, borderColor: '#FFFFFF', numberFormat: '0.00' },
  weekendHours: { background: '#E8EEF0', border: true, borderColor: '#FFFFFF', numberFormat: '0.00' },
  emptyHours: { background: '#D5DEE2', border: true, borderColor: '#FFFFFF', numberFormat: '0.00' },
  signLabel: { borderBottom: true, borderColor: '#7A6A58' },
  signDate: { borderBottom: true, borderColor: '#7A6A58', align: 'right', numberFormat: DATE_FORMAT },
};

export async function generateTimesheet(org, settings, period) {
  const { contractor, client, billing } = settings;
  const summary = periodSummary(org, settings, period);
  const { sheet, cell, merge, height } = newSheet(`${FREQUENCIES[billing.frequency]} Time Sheet`, TIMESHEET_STYLES,
    [16.5, 19.5, 19.5, 19.5, 19.5, 19.5, 19.5]);

  // Title
  merge(0, 0, 0, 6, client.name, 'company');
  height(0, 30);
  merge(2, 0, 2, 6, `${FREQUENCIES[billing.frequency]} time sheet · ${period.label}`, 'subtitle');

  // Contractor, manager and pay period
  const details = [
    ['Contractor:', contractor.name, 'Contractor phone:', contractor.phone],
    ['Contractor e-mail:', contractor.email, 'Pay period start date:', period.start],
    ['Manager:', client.managerName, 'Pay period end date:', period.end],
  ];
  details.forEach(([leftLabel, leftValue, rightLabel, rightValue], i) => {
    const row = 6 + i;
    height(row, 19.5);
    merge(row, 0, row, 1, leftLabel, 'label');
    merge(row, 2, row, 3, leftValue, 'value');
    if (rightValue instanceof Date) {
      merge(row, 4, row, 5, rightLabel, 'label');
      cell(row, 6, rightValue, 'valueDate');
    } else {
      cell(row, 4, rightLabel, 'label');
      merge(row, 5, row, 6, rightValue, 'value');
    }
  });

  // One row per day
  const headerRow = 11;
  height(headerRow, 19.5);
  ['Day', 'Date', 'Regular Hours', 'Overtime Hours', 'Sick', 'Vacation', 'Total']
    .forEach((title, col) => cell(headerRow, col, title, 'header'));

  summary.days.forEach((day, i) => {
    const row = headerRow + 1 + i;
    const excelRow = row + 1;
    const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
    const kind = isWeekend ? 'weekend' : 'weekday';
    height(row, 19.5);
    cell(row, 0, day.date.toLocaleDateString('en-US', { weekday: 'long' }), kind);
    cell(row, 1, day.date, `${kind}Date`);
    cell(row, 2, day.hours, `${kind}Hours`);
    for (const col of [3, 4, 5]) cell(row, col, null, 'emptyHours');
    const total = cell(row, 6, `=SUM(C${excelRow}:F${excelRow})`, `${kind}Hours`);
    total.result = String(day.hours);
  });

  // Totals
  const totalRow = headerRow + 1 + summary.days.length;
  const firstDay = headerRow + 2;
  const lastDay = totalRow;
  height(totalRow, 19.5);
  cell(totalRow, 0, null, 'header');
  cell(totalRow, 1, 'Total', 'header');
  for (const col of [2, 3, 4, 5, 6]) {
    const sum = cell(totalRow, col, `=SUM(${letter(col)}${firstDay}:${letter(col)}${lastDay})`, 'headerNumber');
    sum.result = String(col === 2 || col === 6 ? summary.hours : 0);
  }

  // Signatures
  const signRow = totalRow + 2;
  height(signRow, 42);
  merge(signRow, 0, signRow, 3, 'Employee signature', 'signLabel');
  cell(signRow, 5, 'Date', 'signLabel');
  cell(signRow, 6, new Date(), 'signDate');
  sheet.images.push({ row: signRow, col: 2, path: signaturePath(org, settings), width: 150, height: 43, xOffset: 10, yOffset: 4 });
  height(signRow + 1, 28);
  merge(signRow + 1, 0, signRow + 1, 3, 'Manager signature', 'signLabel');
  cell(signRow + 1, 5, 'Date', 'signLabel');
  cell(signRow + 1, 6, null, 'signLabel');

  const name = billing.frequency === 'monthly'
    ? `Timesheet_${period.fileLabel}_${fileName(contractor.name)}`
    : `Timesheet_${fileName(contractor.name)}_${period.fileLabel}`;
  return saveSheet(org, 'Timesheets', name, sheet);
}

// ======================================================================
// Invoice
// ======================================================================

const ORANGE = '#C0661E';
const INVOICE_STYLES = {
  name: { size: 26, color: ORANGE },
  title: { size: 24, color: '#E8862A', align: 'right' },
  topLine: { borderBottom: true, borderColor: '#E8862A' },
  label: { bold: true, color: '#444444', align: 'right' },
  value: {},
  valueDate: { numberFormat: DATE_FORMAT, align: 'left' },
  address: { wrap: true },
  section: { bold: true, size: 9, color: ORANGE, borderBottom: true, borderColor: '#E8862A' },
  sectionRight: { bold: true, size: 9, color: ORANGE, align: 'right', borderBottom: true, borderColor: '#E8862A' },
  line: { size: 11 },
  hours: { numberFormat: '0.00', align: 'right' },
  money: { numberFormat: '#,##0.00', align: 'right' },
  sumLabel: { bold: true, size: 9, background: '#F2F2F2', borderTop: true, borderColor: '#E8862A' },
  sumMoney: { bold: true, background: '#F2F2F2', numberFormat: '#,##0.00', align: 'right', borderTop: true, borderColor: '#E8862A' },
  smallLabel: { bold: true, size: 9 },
  percent: { numberFormat: '0.000%', align: 'right' },
  totalLabel: { bold: true, size: 12, background: '#D9D9D9', borderTop: true },
  totalMoney: { bold: true, size: 12, background: '#D9D9D9', numberFormat: '#,##0.00', align: 'right', borderTop: true },
  comment: {},
  thanks: { bold: true, size: 12 },
  payable: { align: 'center' },
  payableName: { bold: true, align: 'center' },
};

const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

export async function generateInvoice(org, settings, period, invoiceNumber) {
  const { contractor, client, billing } = settings;
  const summary = periodSummary(org, settings, period);
  const currency = billing.currency.trim();
  const withCurrency = (label) => (currency ? `${label} (${currency})` : label);
  const { sheet, cell, merge, height } = newSheet('Invoice', INVOICE_STYLES, [2, 26, 24, 2, 9, 9, 12, 14, 2]);

  // Header
  height(1, 38);
  cell(1, 1, contractor.name, 'name');
  merge(1, 5, 1, 7, 'INVOICE', 'title');
  for (let col = 0; col <= 8; col++) cell(2, col, null, 'topLine');

  height(3, 22);
  cell(3, 1, 'INVOICE #', 'label');
  cell(3, 2, String(invoiceNumber), 'value');
  cell(3, 6, 'DATE', 'label');
  cell(3, 7, new Date(), 'valueDate');
  if (billing.workOrder.trim()) {
    cell(4, 1, 'WORK ORDER #', 'label');
    cell(4, 2, billing.workOrder.trim(), 'value');
  }

  // Addresses
  const mailing = lines(contractor.mailingAddress);
  const billTo = [client.name, ...lines(client.billingAddress)];
  const addressRows = Math.max(mailing.length, billTo.length);
  cell(6, 1, 'MAILING INFO', 'label');
  cell(6, 4, 'BILL TO', 'label');
  for (let i = 0; i < addressRows; i++) {
    height(6 + i, 19);
    if (mailing[i]) cell(6 + i, 2, mailing[i], 'address');
    if (billTo[i]) merge(6 + i, 5, 6 + i, 7, billTo[i], 'address');
  }

  // Hourly services
  const servicesRow = 6 + addressRows + 2;
  cell(servicesRow, 1, 'HOURLY SERVICES', 'section');
  for (const col of [2, 3, 4]) cell(servicesRow, col, null, 'section');
  cell(servicesRow, 5, 'HOURS', 'sectionRight');
  cell(servicesRow, 6, withCurrency('RATE'), 'sectionRight');
  cell(servicesRow, 7, withCurrency('AMOUNT'), 'sectionRight');

  const lineRow = servicesRow + 1;
  const excelLine = lineRow + 1;
  height(lineRow, 24);
  const days = `${summary.workedDays} worked day${summary.workedDays === 1 ? '' : 's'}`;
  merge(lineRow, 1, lineRow, 4, `${periodDescription(period)}  (${days})`, 'line');
  cell(lineRow, 5, summary.hours, 'hours');
  cell(lineRow, 6, summary.rate, 'money');
  cell(lineRow, 7, `=F${excelLine}*G${excelLine}`, 'money').result = String(summary.subtotal);

  // Totals
  const subtotalRow = lineRow + 2;
  const excel = (row) => row + 1;
  cell(subtotalRow, 6, 'SUBTOTAL', 'sumLabel');
  cell(subtotalRow, 7, `=H${excelLine}`, 'sumMoney').result = String(summary.subtotal);
  cell(subtotalRow + 1, 6, 'TAX RATE', 'smallLabel');
  cell(subtotalRow + 1, 7, (Number(billing.taxRate) || 0) / 100, 'percent');
  cell(subtotalRow + 2, 6, 'TOTAL TAX', 'smallLabel');
  cell(subtotalRow + 2, 7, `=H${excel(subtotalRow)}*H${excel(subtotalRow + 1)}`, 'money').result = String(summary.tax);
  height(subtotalRow + 3, 22);
  cell(subtotalRow + 3, 6, withCurrency('TOTAL'), 'totalLabel');
  cell(subtotalRow + 3, 7, `=H${excel(subtotalRow)}+H${excel(subtotalRow + 2)}`, 'totalMoney').result = String(summary.total);

  // Comments
  const commentsRow = subtotalRow;
  cell(commentsRow, 1, 'OTHER COMMENTS', 'section');
  cell(commentsRow, 2, null, 'section');
  const comments = lines(billing.comments);
  comments.forEach((comment, i) => merge(commentsRow + 1 + i, 1, commentsRow + 1 + i, 4, `${i + 1}. ${comment}`, 'comment'));
  const thanksRow = Math.max(commentsRow + comments.length + 2, subtotalRow + 5);
  cell(thanksRow, 1, 'Thank You For Your Business!', 'thanks');

  // Signature and payment
  const signRow = thanksRow + 2;
  height(signRow, 50);
  sheet.images.push({ row: signRow, col: 2, path: signaturePath(org, settings), width: 160, height: 46, xOffset: 0, yOffset: 2 });
  merge(signRow, 5, signRow, 7, 'Make all checks payable to:', 'payable');
  height(signRow + 1, 24);
  cell(signRow + 1, 1, 'Employee Signature:', 'value');
  merge(signRow + 1, 5, signRow + 1, 7, contractor.payableTo.toUpperCase(), 'payableName');
  height(signRow + 3, 30);
  cell(signRow + 3, 1, 'Manager Signature:', 'value');
  cell(signRow + 3, 2, '________________', 'value');

  const path = await saveSheet(org, 'Invoices',
    `Invoice_${fileName(contractor.name)}_${fileName(client.name)}_${invoiceNumber}_${period.fileLabel}`, sheet);

  // The next invoice gets the next number.
  settings.billing.nextInvoiceNumber = Number(invoiceNumber) + 1;
  await saveSettings(org, settings);
  return path;
}
