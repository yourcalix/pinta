'use strict';

const userService = require('../../../services/user');
const driverDocuments = require('../../../services/driver-documents');

const IDENTITY_TYPES = [
  { value: 'MACAU_RESIDENT_ID', label: '澳门居民身份证' },
  { value: 'HONG_KONG_ID', label: '香港居民身份证' },
  { value: 'MAINLAND_ID', label: '内地居民身份证' },
  { value: 'PASSPORT', label: '护照' },
  { value: 'MAINLAND_TRAVEL_PERMIT', label: '港澳居民来往内地通行证' }
];

function futureDate(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString().slice(0, 10);
}

function emptyForm() {
  return {
    legalName: '', identityType: IDENTITY_TYPES[0].value, identityNumber: '',
    identityExpiresAt: futureDate(5), driverLicenseNumber: '', driverLicenseExpiresAt: futureDate(2),
    vehicleType: '', passengerCapacity: 4, plateNumber: '', documents: {},
    privacyAgreed: false, sensitiveDocumentsAgreed: false
  };
}

Page({
  data: {
    loading: true, step: 1, submitting: false, uploadingKind: '', errorMessage: '',
    identityTypes: IDENTITY_TYPES, identityTypeIndex: 0,
    form: emptyForm(), application: null
  },

  onLoad() { this.loadApplication(); },

  async loadApplication() {
    try {
      await userService.login();
      const result = await userService.getDriverApplication();
      this.setData({ application: result.application, loading: false });
    } catch (error) {
      this.setData({ loading: false, errorMessage: error.handled ? '账号暂时无法使用' : error.message || '认证状态加载失败' });
    }
  },

  handleInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value, errorMessage: '' });
  },

  handleDate(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value, errorMessage: '' });
  },

  handleIdentityType(event) {
    const index = Number(event.detail.value) || 0;
    this.setData({ identityTypeIndex: index, 'form.identityType': IDENTITY_TYPES[index].value, errorMessage: '' });
  },

  handleConsent(event) {
    const values = event.detail.value || [];
    this.setData({
      'form.privacyAgreed': values.includes('privacy'),
      'form.sensitiveDocumentsAgreed': values.includes('documents')
    });
  },

  handleCapacity(event) {
    const delta = Number(event.currentTarget.dataset.delta) || 0;
    this.setData({ 'form.passengerCapacity': Math.min(7, Math.max(2, Number(this.data.form.passengerCapacity) + delta)) });
  },

  async handleUpload(event) {
    const kind = event.currentTarget.dataset.kind;
    if (this.data.uploadingKind) return;
    this.setData({ uploadingKind: kind, errorMessage: '' });
    try {
      const fileID = await driverDocuments.uploadPrivateDocument(kind);
      this.setData({ [`form.documents.${kind}`]: fileID, uploadingKind: '' });
    } catch (error) {
      this.setData({ uploadingKind: '', errorMessage: error.errMsg && /cancel/i.test(error.errMsg) ? '' : error.message || '图片上传失败，请重试' });
    }
  },

  handleNext() {
    const form = this.data.form;
    if (this.data.step === 1 && (!form.legalName.trim() || !form.identityNumber.trim())) return this.setData({ errorMessage: '请填写真实姓名和证件号码' });
    if (this.data.step === 2 && (!form.driverLicenseNumber.trim() || !form.vehicleType.trim() || !form.plateNumber.trim())) return this.setData({ errorMessage: '请补齐驾驶资格和车辆信息' });
    this.setData({ step: Math.min(3, this.data.step + 1), errorMessage: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 180 });
  },

  handleBack() {
    this.setData({ step: Math.max(1, this.data.step - 1), errorMessage: '' });
  },

  async handleSubmit() {
    if (this.data.submitting) return;
    const form = this.data.form;
    const requiredDocuments = ['identityFront', 'driverLicense', 'vehicleExterior'];
    if (requiredDocuments.some((kind) => !form.documents[kind])) return this.setData({ errorMessage: '请上传身份证件、驾驶证和车辆外观照片' });
    if (!form.privacyAgreed || !form.sensitiveDocumentsAgreed) return this.setData({ errorMessage: '请阅读并同意两项资料使用说明' });
    this.setData({ submitting: true, errorMessage: '' });
    try {
      const result = await userService.submitDriverApplication({
        legalName: form.legalName.trim(), identityType: form.identityType,
        identityNumber: form.identityNumber.trim(), identityExpiresAt: `${form.identityExpiresAt}T23:59:59.000Z`,
        driverLicenseNumber: form.driverLicenseNumber.trim(), driverLicenseExpiresAt: `${form.driverLicenseExpiresAt}T23:59:59.000Z`,
        vehicleType: form.vehicleType.trim(), passengerCapacity: form.passengerCapacity, plateNumber: form.plateNumber.trim(),
        documents: form.documents,
        consent: { privacyVersion: 'driver-privacy-v1', driverVerify: true, sensitiveDocuments: true }
      });
      this.setData({ application: result.application, form: emptyForm(), submitting: false, step: 1 });
      wx.showToast({ title: '已提交审核', icon: 'success' });
    } catch (error) {
      this.setData({ submitting: false, errorMessage: error.handled ? '账号暂时无法使用' : error.message || '提交失败，请重试' });
    }
  }
});
