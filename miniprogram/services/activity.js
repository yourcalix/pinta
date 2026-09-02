'use strict';

const api = require('./api');

module.exports = {
  list: (filters) => api.invoke('activity.list', filters),
  detail: (activityId) => api.invoke('activity.detail', { activityId }),
  mine: () => api.invoke('activity.mine'),
  create: (payload, idempotencyKey) => api.invoke('activity.create', payload, { mutating: true, idempotencyKey }),
  cancel: (activityId, reason) => api.invoke('activity.cancel', { activityId, reason }, { mutating: true }),
  complete: (activityId) => api.invoke('activity.complete', { activityId }, { mutating: true }),
  qaList: (activityId, cursor, limit = 10) => api.invoke('activity.question.list', { activityId, cursor, limit }),
  askQuestion: (activityId, content) => api.invoke('activity.question.ask', { activityId, content }, { mutating: true }),
  answerQuestion: (activityId, questionId, content) => api.invoke('activity.question.answer', { activityId, questionId, content }, { mutating: true }),
  apply: (activityId, note) => api.invoke('application.submit', { activityId, note, autoJoinConsent: true }, { mutating: true }),
  withdraw: (applicationId) => api.invoke('application.withdraw', { applicationId }, { mutating: true }),
  leave: (activityId, reason) => api.invoke('member.leave', { activityId, reason }, { mutating: true }),
  applications: (activityId) => api.invoke('application.listForOwner', { activityId }),
  approve: (activityId, applicationId) => api.invoke('application.approve', { activityId, applicationId }, { mutating: true }),
  reject: (applicationId) => api.invoke('application.reject', { applicationId }, { mutating: true }),
  groupSpace: (activityId) => api.invoke('group.space', { activityId }),
  shareContact: (activityId, type, value) => api.invoke('group.contact.share', { activityId, type, value }, { mutating: true }),
  revokeContact: (activityId) => api.invoke('group.contact.revoke', { activityId }, { mutating: true })
};
