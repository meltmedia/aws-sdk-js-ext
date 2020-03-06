'use strict';

const
  AWS = require('aws-sdk'),
  _ = require('lodash'),
  error = require('./error');

/**
 * @typedef  {object} EncryptedPayload
 * @property {string} data - The encrypted data
 * @property {string} key - The key used to encrypt the data
 */

class EncryptionUtil {

  /**
   * Creates a new EncryptionUtil instance
   * @param  {object} config - The configuration for the encryption
   * @param  {string} config.key - The KMS key to use for encryption
   * @param  {AWS.KMS} [kms] - The AWS KMS instance
   * @return {EncryptionUtil}
   */
  constructor(config, kms) {
    config = config || {};
    this.key = config && config.key;
    this.kms = kms || new AWS.KMS(config.kmsOptions || {});
  }

  /**
   * Encrypts data using a key name.
   * @param  {*} data - The data to encrypt.
   * @param  {string} algorithm - The algorithm to use for encryption.
   * @param  {string} keyName - The name of the key to encrypt with.
   * @return {EncryptedPayload}
   */
  encrypt(data) {
    if (!this.key) return Promise.reject(new error.EncryptionConfigurationError('key'));
    let params = {
      KeyId: this.key,
      Plaintext: JSON.stringify(data)
    };
    return this.kms.encrypt(params).promise()
      .then(encryptionResponse => {
        return {
          data: encryptionResponse.CiphertextBlob.toString('hex'),
          key: encryptionResponse.KeyId
        };
      });
  }

  /**
   * Decrypts the data using the given key.
   * @param  {EncryptedPayload} encryptedPayload - The encrypted payload.
   * @param  {string} algorithm - The algorithm to use for decryption.
   * @param  {AWS.KMS} kms - An AWS KMS instance.
   * @return {*} - The decrypted data.
   */
  decrypt(encryptedPayload) {
    return Promise.resolve()
      .then(() => {
        return {
          CiphertextBlob: Buffer.from(encryptedPayload.data, 'hex')
        };
      })
      .then(params => this.kms.decrypt(params).promise())
      .then(decryptionResponse => {
        let dataString = decryptionResponse.Plaintext.toString();
        if (_.isEmpty(dataString)) {
          throw new TypeError('Data payload was not encrypted correctly');
        }
        try {
          return JSON.parse(dataString);
        } catch (e) {
          throw new TypeError(`Decrypted payload is not a valid JSON: ${e}`);
        }
      })
      .catch(error => {
        console.error(error);
        throw new Error(`Error decrypting payload: ${e}`)
      });
  };
}

module.exports = EncryptionUtil;
