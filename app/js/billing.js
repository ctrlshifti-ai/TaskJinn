// Timesheet and invoice settings of an organization, the pay periods they cover,
// and the hours worked on each day.
//
// The settings are one JSON file in the organization's folder (settings.json). The signature
// image is copied next to it (signature.png / .jpg).

import { api } from './api.js';
import * as u from './util.js';

const SETTINGS_FILE = 'settings.json';
export const FREQUENCIES = { weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly' };
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- Settings ----------

function defaultSettings(org) {
  return {
    contractor: { name: '', email: '', phone: '', mailingAddress: '', payableTo: '', signatureFile: '' },
    client: { name: org.name, billingAddress: '', managerName: '' },
    billing: {
      frequency: 'monthly',
      periodStart: '',          // first day of any one period (weekly and bi-weekly only)
      hourlyRate: null,
      currency: '',
      taxRate: 0,               // percent
      nextInvoiceNumber: 1,
      workOrder: '',
      comments: 'Total payment due in 15 days\nPlease include the invoice number on your check',
    },
  };
}

export async function loadSettings(org) {
  const text = await api.readText(u.joinPath(org.folderPath, SETTINGS_FILE));
  const saved = text ? JSON.parse(text) : {};
  const defaults = defaultSettings(org);
  return {
    contractor: { ...defaults.contractor, ...saved.contractor },
    client: { ...defaults.client, ...saved.client },
    billing: { ...defaults.billing, ...saved.billing },
  };
}

export async function saveSettings(org, settings) {
  await api.writeText(u.joinPath(org.folderPath, SETTINGS_FILE), JSON.stringify(settings, null, 2));
}

export const signaturePath = (org, settings) =>
  settings.contractor.signatureFile ? u.joinPath(org.folderPath, settings.contractor.signatureFile) : '';

/** Copies the chosen signature image into the organization's folder. Returns its new file name. */
export async function storeSignature(org, sourcePath) {
  const extension = sourcePath.split('.').pop().toLowerCase();
  const fileName = `signature.${extension}`;
  await api.copyFile(sourcePath, u.joinPath(org.folderPath, fileName));
  return fileName;
}

/** The required details that are still missing. An empty list means timesheets and invoices can be made. */
export async function missingDetails(org, settings) {
  const { contractor, client, billing } = settings;
  const missing = [];
  const need = (value, label) => { if (!String(value ?? '').trim()) missing.push(label); };

  need(contractor.name, 'Your name');
  need(contractor.email, 'Your email');
  need(contractor.phone, 'Your phone');
  need(contractor.mailingAddress, 'Your mailing address');
  need(contractor.payableTo, 'Payments payable to');
  const signature = signaturePath(org, settings);
  if (!signature || !(await api.pathInfo(signature)).exists) missing.push('Signature image');

  need(client.name, 'Client name');
  need(client.billingAddress, 'Client billing address');
  need(client.managerName, 'Manager name');

  if (!FREQUENCIES[billing.frequency]) missing.push('How often (weekly, bi-weekly or monthly)');
  if (billing.frequency !== 'monthly' && !billing.periodStart) missing.push('First day of a pay period');
  if (!(Number(billing.hourlyRate) > 0)) missing.push('Hourly rate');
  if (!(Number(billing.taxRate) >= 0)) missing.push('Tax rate');
  if (!(Number.isInteger(Number(billing.nextInvoiceNumber)) && Number(billing.nextInvoiceNumber) >= 1)) {
    missing.push('Next invoice number');
  }
  return missing;
}

// ---------- Dates (local calendar days, written as "YYYY-MM-DD") ----------

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const monthName = (date) => date.toLocaleDateString('en-US', { month: 'long' });

/** "1st", "2nd", "3rd", "4th"... */
function ordinal(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

// ---------- Pay periods ----------

/**
 * The most recent pay periods, newest first. The first one contains today.
 * Each period: { start: Date, end: Date, label, fileLabel }
 */
export function recentPeriods(billing, today = new Date(), count = 12) {
  const periods = [];
  if (billing.frequency === 'monthly') {
    for (let i = 0; i < count; i++) {
      const start = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
      const label = `${monthName(start)} ${start.getFullYear()}`;
      periods.push({ start, end, label, fileLabel: label.replace(' ', '_') });
    }
    return periods;
  }

  // Weekly / bi-weekly: count whole periods from the configured first day.
  const length = billing.frequency === 'weekly' ? 7 : 14;
  const anchor = parseKey(billing.periodStart);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysSinceAnchor = Math.round((todayStart - anchor) / DAY_MS);
  const currentStart = addDays(anchor, Math.floor(daysSinceAnchor / length) * length);

  for (let i = 0; i < count; i++) {
    const start = addDays(currentStart, -i * length);
    const end = addDays(start, length - 1);
    const label = `${u.formatDate(start.getTime())} – ${u.formatDate(end.getTime())}`;
    periods.push({ start, end, label, fileLabel: `${dateKey(start)}_to_${dateKey(end)}` });
  }
  return periods;
}

/** "October 1st – October 31st" (adds the year when the period spans two years). */
export function periodDescription(period) {
  const sameYear = period.start.getFullYear() === period.end.getFullYear();
  const part = (date) => `${monthName(date)} ${ordinal(date.getDate())}${sameYear ? '' : `, ${date.getFullYear()}`}`;
  return `${part(period.start)} – ${part(period.end)}`;
}

// ---------- Hours ----------

const roundHours = (ms) => Math.round((ms / 3600000) * 100) / 100;

/**
 * Hours tracked on each day of the period, across all of the organization's tasks.
 * A session that runs past midnight is split between the two days.
 * Returns [{ key: "YYYY-MM-DD", date: Date, hours }] for every day of the period.
 */
export function hoursPerDay(org, period, now = Date.now()) {
  const firstKey = dateKey(period.start);
  const lastKey = dateKey(period.end);
  const msByDay = {};

  for (const project of org.projects) {
    for (const task of project.tasks) {
      for (const entry of task.entries) {
        let from = entry.startedAt;
        const until = entry.endedAt ?? now;
        while (from < until) {
          const day = new Date(from);
          const nextMidnight = addDays(day, 1).getTime();
          const pieceEnd = Math.min(until, nextMidnight);
          const key = dateKey(day);
          if (key >= firstKey && key <= lastKey) msByDay[key] = (msByDay[key] ?? 0) + (pieceEnd - from);
          from = pieceEnd;
        }
      }
    }
  }

  const days = [];
  for (let date = period.start; date <= period.end; date = addDays(date, 1)) {
    const key = dateKey(date);
    days.push({ key, date, hours: roundHours(msByDay[key] ?? 0) });
  }
  return days;
}

/** Totals for a period: hours, worked days, and the invoice amounts. */
export function periodSummary(org, settings, period) {
  const days = hoursPerDay(org, period);
  const hours = Math.round(days.reduce((sum, d) => sum + d.hours, 0) * 100) / 100;
  const rate = Number(settings.billing.hourlyRate) || 0;
  const subtotal = Math.round(hours * rate * 100) / 100;
  const tax = Math.round(subtotal * (Number(settings.billing.taxRate) || 0)) / 100;
  return {
    days,
    hours,
    workedDays: days.filter((d) => d.hours > 0).length,
    rate,
    subtotal,
    tax,
    total: Math.round((subtotal + tax) * 100) / 100,
  };
}
