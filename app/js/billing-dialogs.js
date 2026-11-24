// Dialogs for timesheets and invoices: the organization's settings, and picking a period to generate.

import { api } from './api.js';
import * as billing from './billing.js';
import { generateInvoice, generateTimesheet } from './reports.js';
import { Modal } from './components.js';

/** Edits the organization's settings.json, including the signature image. */
export const SettingsDialog = {
  components: { Modal },
  props: ['org'],
  emits: ['close'],
  data: () => ({ settings: null, signatureUrl: '', missing: [], saved: false }),
  template: `
    <Modal :title="'Timesheet & Invoice Settings · ' + org.name" wide @close="$emit('close')">
      <form v-if="settings" class="settings" @submit.prevent="save">
        <p v-if="missing.length" class="settings-missing">
          Still needed before you can generate: {{ missing.join(', ') }}.
        </p>
        <p v-else class="settings-ready">✓ Everything needed is filled in.</p>

        <h4>You (contractor)</h4>
        <div class="settings-grid">
          <label class="field">Full name <input v-model="settings.contractor.name"></label>
          <label class="field">Payments payable to <input v-model="settings.contractor.payableTo" placeholder="Name on checks"></label>
          <label class="field">Email <input v-model="settings.contractor.email" type="email"></label>
          <label class="field">Phone <input v-model="settings.contractor.phone"></label>
          <label class="field span-2">Mailing address <textarea v-model="settings.contractor.mailingAddress" rows="4"
                 placeholder="One line per row"></textarea></label>
        </div>

        <h4>Signature</h4>
        <div class="signature-row">
          <div class="signature-box">
            <img v-if="signatureUrl" :src="signatureUrl" alt="Signature">
            <span v-else class="muted">No signature image</span>
          </div>
          <div>
            <button type="button" @click="chooseSignature">Choose Image…</button>
            <p class="muted small">PNG or JPG. A copy is saved in this organization's folder.</p>
          </div>
        </div>

        <h4>Client</h4>
        <div class="settings-grid">
          <label class="field">Client name <input v-model="settings.client.name"></label>
          <label class="field">Manager name <input v-model="settings.client.managerName"></label>
          <label class="field span-2">Billing address <textarea v-model="settings.client.billingAddress" rows="3"
                 placeholder="One line per row"></textarea></label>
        </div>

        <h4>Billing</h4>
        <div class="settings-grid">
          <label class="field">How often
            <select v-model="settings.billing.frequency">
              <option v-for="(label, key) in frequencies" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <label v-if="settings.billing.frequency !== 'monthly'" class="field">First day of a pay period
            <input v-model="settings.billing.periodStart" type="date">
          </label>
          <label class="field">Hourly rate <input v-model.number="settings.billing.hourlyRate" type="number" min="0" step="0.01"></label>
          <label class="field">Currency (optional) <input v-model="settings.billing.currency" placeholder="e.g. USD"></label>
          <label class="field">Tax rate % <input v-model.number="settings.billing.taxRate" type="number" min="0" step="0.001"></label>
          <label class="field">Next invoice number <input v-model.number="settings.billing.nextInvoiceNumber" type="number" min="1" step="1"></label>
          <label class="field">Work order # (optional) <input v-model="settings.billing.workOrder"></label>
          <label class="field span-2">Invoice comments (one per line)
            <textarea v-model="settings.billing.comments" rows="2"></textarea></label>
        </div>

        <div class="modal-buttons">
          <span v-if="saved" class="muted small">Saved</span>
          <button type="button" @click="$emit('close')">Close</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </Modal>`,
  computed: {
    frequencies: () => billing.FREQUENCIES,
  },
  async mounted() {
    this.settings = await billing.loadSettings(this.org);
    await this.refresh();
  },
  methods: {
    async refresh() {
      const path = billing.signaturePath(this.org, this.settings);
      const exists = path && (await api.pathInfo(path)).exists;
      const type = path.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
      this.signatureUrl = exists ? `data:image/${type};base64,${await api.readBase64(path)}` : '';
      this.missing = await billing.missingDetails(this.org, this.settings);
    },
    async chooseSignature() {
      const source = await api.pickFile('Choose your signature image', ['png', 'jpg', 'jpeg']);
      if (!source) return;
      this.settings.contractor.signatureFile = await billing.storeSignature(this.org, source);
      await billing.saveSettings(this.org, this.settings);
      await this.refresh();
    },
    async save() {
      await billing.saveSettings(this.org, this.settings);
      await this.refresh();
      this.saved = true;
      setTimeout(() => { this.saved = false; }, 1500);
    },
  },
};

/** Picks a pay period and generates the timesheet or invoice for it. */
export const GenerateDialog = {
  components: { Modal },
  props: ['org', 'kind', 'settings'],   // kind: "timesheet" or "invoice"
  emits: ['close', 'done'],
  data() {
    const periods = billing.recentPeriods(this.settings.billing);
    return {
      periods,
      index: 1,   // the last finished period (0 is the one still running)
      invoiceNumber: this.settings.billing.nextInvoiceNumber,
      busy: false,
      error: '',
    };
  },
  template: `
    <Modal :title="(isInvoice ? 'Generate Invoice' : 'Generate Timesheet') + ' · ' + org.name" @close="$emit('close')">
      <label class="field">{{ frequencyLabel }} pay period
        <select v-model.number="index">
          <option v-for="(p, i) in periods" :key="p.label" :value="i">{{ p.label }}{{ i === 0 ? ' (current)' : '' }}</option>
        </select>
      </label>
      <label v-if="isInvoice" class="field">Invoice number
        <input v-model.number="invoiceNumber" type="number" min="1" step="1">
      </label>

      <div class="stats">
        <div><span>Hours tracked</span><b>{{ summary.hours.toFixed(2) }}</b></div>
        <div><span>Days worked</span><b>{{ summary.workedDays }}</b></div>
        <template v-if="isInvoice">
          <div><span>Rate</span><b>{{ money(summary.rate) }}</b></div>
          <div><span>Subtotal</span><b>{{ money(summary.subtotal) }}</b></div>
          <div><span>Tax ({{ settings.billing.taxRate }}%)</span><b>{{ money(summary.tax) }}</b></div>
          <div><span>Total</span><b>{{ money(summary.total) }}</b></div>
        </template>
      </div>
      <p v-if="summary.hours === 0" class="warn small">No time was tracked in this period.</p>
      <p v-if="error" class="danger small">{{ error }}</p>

      <div class="modal-buttons">
        <button @click="$emit('close')">Cancel</button>
        <button class="primary" :disabled="busy || (isInvoice && !(invoiceNumber >= 1))" @click="generate">
          {{ busy ? 'Generating…' : 'Generate' }}</button>
      </div>
    </Modal>`,
  computed: {
    isInvoice() { return this.kind === 'invoice'; },
    frequencyLabel() { return billing.FREQUENCIES[this.settings.billing.frequency]; },
    summary() { return billing.periodSummary(this.org, this.settings, this.periods[this.index]); },
  },
  methods: {
    money(value) {
      const text = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return this.settings.billing.currency ? `${text} ${this.settings.billing.currency}` : text;
    },
    async generate() {
      this.busy = true;
      this.error = '';
      try {
        const period = this.periods[this.index];
        const path = this.isInvoice
          ? await generateInvoice(this.org, this.settings, period, this.invoiceNumber)
          : await generateTimesheet(this.org, this.settings, period);
        await api.openPath(path);
        this.$emit('done', path);
      } catch (error) {
        this.error = `Couldn't create the file: ${error}`;
      }
      this.busy = false;
    },
  },
};
