'use strict';

const crypto = require('crypto');
const { AppError } = require('./errors');

function keysFromSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 16) throw new AppError('DRIVER_APPLICATION_UNAVAILABLE');
  const root = Buffer.from(secret, 'utf8');
  return {
    encryption: Buffer.from(crypto.hkdfSync('sha256', root, Buffer.from('pinba-driver-v1'), Buffer.from('encryption'), 32)),
    hmac: Buffer.from(crypto.hkdfSync('sha256', root, Buffer.from('pinba-driver-v1'), Buffer.from('hmac'), 32))
  };
}

function encrypt(value, key, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    ciphertext: body.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

function protectValue(value, keys, aad) {
  const normalized = String(value).trim();
  return {
    enc: encrypt(normalized, keys.encryption, aad),
    hmac: crypto.createHmac('sha256', keys.hmac).update(normalized.toUpperCase()).digest('hex'),
    last4: normalized.slice(-4)
  };
}

function protectDriverApplication(payload, secret, options = {}) {
  const keys = keysFromSecret(secret);
  const userId = options.userId || 'unknown';
  const keyVersion = Number(options.keyVersion) || 1;
  const aad = (field) => `${userId}:${field}:v${keyVersion}`;
  return {
    summary: {
      legalNameMasked: `${payload.legalName.slice(0, 1)}**`,
      identityType: payload.identityType,
      identityLast4: payload.identityNumber.slice(-4),
      identityExpiresAt: payload.identityExpiresAt,
      driverLicenseLast4: payload.driverLicenseNumber.slice(-4),
      driverLicenseExpiresAt: payload.driverLicenseExpiresAt,
      vehicleType: payload.vehicleType,
      passengerCapacity: payload.passengerCapacity,
      plateMasked: `***${payload.plateNumber.slice(-2)}`,
      documentKinds: Object.keys(payload.documents).filter((kind) => Boolean(payload.documents[kind]))
    },
    secrets: {
      legalName: encrypt(payload.legalName, keys.encryption, aad('legalName')),
      identityNumber: protectValue(payload.identityNumber, keys, aad('identityNumber')),
      driverLicenseNumber: protectValue(payload.driverLicenseNumber, keys, aad('driverLicenseNumber')),
      plateNumber: protectValue(payload.plateNumber, keys, aad('plateNumber')),
      documents: Object.fromEntries(Object.entries(payload.documents).map(([kind, reference]) => [kind, encrypt(reference.fileID, keys.encryption, aad(`document:${kind}`))])),
      keyVersion
    }
  };
}

module.exports = { protectDriverApplication };
