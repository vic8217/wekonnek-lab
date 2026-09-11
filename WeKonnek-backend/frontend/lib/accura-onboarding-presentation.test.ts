import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accuraBusinessInfoPresentation,
  accuraOnboardingPresentation,
  hasAuthoritativeTaxpayerProfile,
  isAccuraReadinessComplete,
  submittedForReviewNotice,
} from './accura-onboarding-presentation';

test('80% readiness keeps submit disabled and Setup Incomplete', () => {
  const ui = accuraOnboardingPresentation({
    reviewStatus: 'INCOMPLETE',
    readinessComplete: false,
    readinessPercent: 80,
  });
  assert.equal(isAccuraReadinessComplete({ complete: false, percent: 80 }), false);
  assert.equal(ui.phase, 'incomplete');
  assert.equal(ui.title, 'Setup Incomplete');
  assert.notEqual(ui.title, 'Incomplete');
  assert.equal(ui.submitEnabled, false);
  assert.equal(ui.submitLabel, 'Submit for ACCURA Review');
});

test('100% readiness and not submitted enables Submit and Ready for Submission', () => {
  const ui = accuraOnboardingPresentation({
    reviewStatus: 'INCOMPLETE',
    readinessComplete: true,
    readinessPercent: 100,
  });
  assert.equal(ui.phase, 'ready');
  assert.equal(ui.title, 'Ready for Submission');
  assert.equal(
    ui.body,
    'Your E-Receipt setup is complete. Submit your registration for ACCURA review.',
  );
  assert.equal(ui.submitEnabled, true);
  assert.equal(ui.submitLabel, 'Submit for ACCURA Review');
  assert.equal(ui.title.includes('BIR Approved'), false);
});

test('successful submit notice is SUBMITTED FOR REVIEW and status is Submitted for Review', () => {
  const notice = submittedForReviewNotice(true);
  assert.equal(notice?.title, 'SUBMITTED FOR REVIEW');
  assert.equal(
    notice?.body,
    'Your registration has been submitted to ACCURA for review.',
  );
  const ui = accuraOnboardingPresentation({
    reviewStatus: 'SUBMITTED',
    readinessComplete: true,
    readinessPercent: 100,
  });
  assert.equal(ui.phase, 'submitted');
  assert.equal(ui.title, 'Submitted for Review');
  assert.equal(ui.submitEnabled, false);
});

test('refresh after submission keeps Submitted for Review from ACCURA status', () => {
  const afterReload = accuraOnboardingPresentation({
    reviewStatus: 'SUBMITTED',
    readinessComplete: true,
    readinessPercent: 100,
  });
  assert.equal(afterReload.title, 'Submitted for Review');
  assert.equal(afterReload.submitEnabled, false);
  assert.equal(submittedForReviewNotice(false), null);
});

test('duplicate submit is prevented while submitted or under review', () => {
  const submitted = accuraOnboardingPresentation({
    reviewStatus: 'SUBMITTED',
    readinessComplete: true,
    readinessPercent: 100,
  });
  const underReview = accuraOnboardingPresentation({
    reviewStatus: 'UNDER_REVIEW',
    readinessComplete: true,
    readinessPercent: 100,
  });
  assert.equal(submitted.submitEnabled, false);
  assert.equal(underReview.submitEnabled, false);
  assert.equal(underReview.title, 'Under ACCURA Review');
});

test('correction requested shows Correction Required and resubmit only when ready', () => {
  const incomplete = accuraOnboardingPresentation({
    reviewStatus: 'NEEDS_CORRECTION',
    correctionRequired: true,
    readinessComplete: false,
    readinessPercent: 80,
  });
  assert.equal(incomplete.title, 'Correction Required');
  assert.equal(incomplete.submitEnabled, false);
  assert.equal(incomplete.submitLabel, 'Resubmit for ACCURA Review');
  const ready = accuraOnboardingPresentation({
    reviewStatus: 'NEEDS_CORRECTION',
    correctionRequired: true,
    readinessComplete: true,
    readinessPercent: 100,
  });
  assert.equal(ready.submitEnabled, true);
  assert.equal(ready.submitLabel, 'Resubmit for ACCURA Review');
});

test('approved shows Approved for ACCURA Setup and disables submit', () => {
  const ui = accuraOnboardingPresentation({
    reviewStatus: 'APPROVED',
    readinessComplete: true,
    readinessPercent: 100,
  });
  assert.equal(ui.title, 'Approved for ACCURA Setup');
  assert.equal(ui.submitEnabled, false);
  assert.equal(/BIR (Approved|Certified|Accredited|Verified)/i.test(ui.title), false);
  assert.equal(/BIR (Approved|Certified|Accredited|Verified)/i.test(ui.body), false);
});

test('failed submit does not invent a Submitted state', () => {
  const notice = submittedForReviewNotice(false);
  const ui = accuraOnboardingPresentation({
    reviewStatus: 'INCOMPLETE',
    readinessComplete: true,
    readinessPercent: 100,
  });
  assert.equal(notice, null);
  assert.equal(ui.phase, 'ready');
  assert.notEqual(ui.phase, 'submitted');
});

const emptyProfile = {
  legalName: '',
  tin: '',
  registeredAddressLine1: '',
  classification: '',
};
const savedProfile = {
  legalName: 'ABC FOOD CORPORATION',
  tin: '123456789000',
  registeredAddressLine1: '1 Ayala Ave',
  classification: 'VAT',
};

test('new ACCURA profile shows Save and does not treat WeKonnek prefill as saved', () => {
  assert.equal(hasAuthoritativeTaxpayerProfile(emptyProfile), false);
  const ui = accuraBusinessInfoPresentation({
    profile: emptyProfile,
    reviewStatus: 'INCOMPLETE',
  });
  assert.equal(ui.showSave, true);
  assert.equal(ui.primaryLabel, 'Save');
  assert.equal(ui.fieldsDisabled, false);
  assert.equal(ui.showEdit, false);
});

test('successful save and page reload show Edit from ACCURA profile', () => {
  assert.equal(hasAuthoritativeTaxpayerProfile(savedProfile), true);
  const afterSave = accuraBusinessInfoPresentation({
    profile: savedProfile,
    reviewStatus: 'INCOMPLETE',
  });
  assert.equal(afterSave.showEdit, true);
  assert.equal(afterSave.primaryLabel, 'Edit');
  assert.equal(afterSave.fieldsDisabled, true);
  const afterReload = accuraBusinessInfoPresentation({
    profile: savedProfile,
    reviewStatus: 'INCOMPLETE',
    editing: false,
  });
  assert.equal(afterReload.showEdit, true);
  assert.equal(afterReload.showSave, false);
});

test('failed save does not switch to Edit', () => {
  const stillUnsaved = accuraBusinessInfoPresentation({
    profile: emptyProfile,
    reviewStatus: 'INCOMPLETE',
  });
  assert.equal(stillUnsaved.showSave, true);
  assert.equal(stillUnsaved.showEdit, false);
});

test('Edit enables Save Changes and Cancel restores by leaving edit mode', () => {
  const editing = accuraBusinessInfoPresentation({
    profile: savedProfile,
    reviewStatus: 'INCOMPLETE',
    editing: true,
  });
  assert.equal(editing.fieldsDisabled, false);
  assert.equal(editing.showSaveChanges, true);
  assert.equal(editing.primaryLabel, 'Save Changes');
  assert.equal(editing.showCancel, true);
  const cancelled = accuraBusinessInfoPresentation({
    profile: savedProfile,
    reviewStatus: 'INCOMPLETE',
    editing: false,
  });
  assert.equal(cancelled.showEdit, true);
  assert.equal(cancelled.fieldsDisabled, true);
});

test('Save Changes success returns to Edit; failed update stays in edit mode', () => {
  const success = accuraBusinessInfoPresentation({
    profile: savedProfile,
    reviewStatus: 'INCOMPLETE',
    editing: false,
  });
  assert.equal(success.showEdit, true);
  const failed = accuraBusinessInfoPresentation({
    profile: savedProfile,
    reviewStatus: 'INCOMPLETE',
    editing: true,
  });
  assert.equal(failed.showSaveChanges, true);
  assert.equal(failed.showEdit, false);
});

test('Submitted for Review locks business information editing', () => {
  const ui = accuraBusinessInfoPresentation({
    profile: savedProfile,
    reviewStatus: 'SUBMITTED',
    editing: true,
  });
  assert.equal(ui.fieldsDisabled, true);
  assert.equal(ui.showEdit, false);
  assert.equal(ui.showSave, false);
  assert.equal(ui.showSaveChanges, false);
  assert.equal(ui.lockLabel, 'Submitted for Review');
});

test('Correction Requested enables Edit again', () => {
  const ui = accuraBusinessInfoPresentation({
    profile: savedProfile,
    reviewStatus: 'NEEDS_CORRECTION',
    correctionRequired: true,
  });
  assert.equal(ui.showEdit, true);
  assert.equal(ui.fieldsDisabled, true);
  const editing = accuraBusinessInfoPresentation({
    profile: savedProfile,
    reviewStatus: 'NEEDS_CORRECTION',
    correctionRequired: true,
    editing: true,
  });
  assert.equal(editing.showSaveChanges, true);
  assert.equal(editing.fieldsDisabled, false);
});
