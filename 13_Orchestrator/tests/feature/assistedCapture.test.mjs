/** "Capture manually": capture validation + where it may run. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAssistedCapture, assistedCaptureAvailability } from '../../stages/assistedCaptureStage.js';
import { createBenchmarkTarget } from '../../runtime/benchmarkTarget.js';

const target = createBenchmarkTarget({ company: 'Emirates', slug: 'emirates', url: 'https://www.emirates.com/sa/english/', feature: 'Passenger Details', scope: [], requestId: 'req_v' });

test('validateAssistedCapture: accepts a real page on the target domain (any subdomain)', () => {
  const html = `<html><body>${'<label>First name</label><input><label>Passport number</label><input>'.repeat(80)}</body></html>`;
  assert.equal(validateAssistedCapture(target, { url: 'https://fly4.emirates.com/booking/passengers', title: 'Passenger details', html }).ok, true);
});

test('validateAssistedCapture: refuses another domain, a block page, and a blank tab', () => {
  assert.equal(validateAssistedCapture(target, { url: 'https://www.qatarairways.com/', title: '', html: '' }).ok, false);
  assert.equal(validateAssistedCapture(target, { url: 'https://www.emirates.com/error/accessrestricted.html', title: '', html: '' }).ok, false);
  assert.equal(validateAssistedCapture(target, { url: 'about:blank', title: '', html: '' }).ok, false);
});

test('assistedCaptureAvailability: refused on the hosted server, allowed on a desktop', () => {
  assert.equal(assistedCaptureAvailability({ RENDER: 'true' }, 'linux').ok, false);
  assert.equal(assistedCaptureAvailability({}, 'linux').ok, false);
  assert.equal(assistedCaptureAvailability({}, 'win32').ok, true);
  assert.equal(assistedCaptureAvailability({}, 'darwin').ok, true);
});

