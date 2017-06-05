'use strict';

const
  AWS = require('aws-sdk'),
  CryptoJS = require('crypto-js'),
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
    this.key = config && config.key;
    this.kms = kms || new AWS.KMS();
  }

  /**
   * Encrypts data using a key name.
   * @param  {*} data - The data to encrypt.
   * @param  {string} algorithm - The algorithm to use for encryption.
   * @param  {string} keyName - The name of the key to encrypt with.
   * @return {EncryptedPayload}
   */
  encrypt(data) {
    if(!this.key) return Promise.reject(new error.EncryptionConfigurationError('key'));
    let params = {
      KeyId: this.key,
      KeySpec: 'AES_256'
    };
    return this.kms.generateDataKey(params).promise()
      .then(keys => {
        keys.Plaintext = keys.Plaintext.toString('hex');
        keys.CiphertextBlob = keys.CiphertextBlob.toString('hex');
        return keys;
      })
      .then(keys => {
          let encryptedData = CryptoJS.AES.encrypt(JSON.stringify(data), keys.Plaintext).toString();
          keys.Plaintext = null; // We want to explicitly wipe the plain text key from memory

          return {
            data: encryptedData,
            key: keys.CiphertextBlob
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
          CiphertextBlob: Buffer.from(encryptedPayload.key, 'hex')
        };
      })
      .then(params => this.kms.decrypt(params).promise())
      .then(decryptedKey => {
        let key = decryptedKey.Plaintext.toString('hex');
        decryptedKey.Plaintext = null; // We want to explicitly wipe the plain text key from memory

        let bytes  = CryptoJS.AES.decrypt(encryptedPayload.data, key);
        let dataString = bytes.toString(CryptoJS.enc.Utf8);

        try {
          return JSON.parse(dataString);
        } catch(e) {
          return dataString;
        }
      });
  }
}

module.exports = EncryptionUtil;
