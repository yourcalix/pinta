'use strict';

const cloud = require('wx-server-sdk');
const { CloudStore } = require('./lib/cloud-store');
const { createPinbaService } = require('./lib/service');
const { createWechatModeration } = require('./lib/moderation');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const store = new CloudStore(cloud);
const developmentDriverReviewEnabled = ['development', 'test'].includes(process.env.PINBA_ENV)
  && process.env.ENABLE_DEV_DRIVER_REVIEW === 'true';
const service = createPinbaService({
  store,
  rideDriverAcceptanceEnabled: process.env.ENABLE_RIDE_DRIVER_ACCEPTANCE === 'true',
  driverCredentialSecret: process.env.DRIVER_CREDENTIAL_SECRET || '',
  driverReviewEnabled: developmentDriverReviewEnabled,
  driverApplicationAutoApprove: developmentDriverReviewEnabled,
  driverAutoApprovalEnvironment: developmentDriverReviewEnabled ? process.env.PINBA_ENV : '',
  moderation: createWechatModeration(cloud, {
    enabled: process.env.ENABLE_WECHAT_CONTENT_CHECK === 'true',
    production: process.env.PINBA_ENV === 'production'
  })
});

exports.main = async (event) => {
  const context = cloud.getWXContext();
  return service.execute(event, { actorId: context.OPENID || null });
};
