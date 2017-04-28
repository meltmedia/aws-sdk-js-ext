'use strict';

const
  CryptoJS = require('crypto-js');

/**
 * @typedef  {object} EncryptedPayload
 * @property {string} data - The encrypted data
 * @property {string} key - The key used to encrypt the data
 */

/**
 * Encrypts data using a key name.
 * @param  {*} data - The data to encrypt.
 * @param  {string} algorithm - The algorithm to use for encryption.
 * @param  {AWS.KMS} kms - An AWS KMS instance.
 * @param  {string} keyName - The name of the key to encrypt with.
 * @return {EncryptedPayload}
 */
function encrypt(data, kms, keyName) {
  let params = {
    KeyId: keyName,
    KeySpec: 'AES_256'
  };
  return kms.generateDataKey(params).promise()
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
function decrypt(encryptedPayload, kms) {
  let params = {
    CiphertextBlob: encryptedPayload.key
  };
  return kms.decrypt(params).promise()
    .then(decryptedKey => {
      let bytes  = CryptoJS.AES.decrypt(encryptedPayload.data, decryptedKey);
      let decryptedData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));

      decryptedKey = null; // We want to explicitly wipe the plain text key from memory

      return decryptedData;
    });
}

module.exports = {
  encrypt,
  decrypt
};
