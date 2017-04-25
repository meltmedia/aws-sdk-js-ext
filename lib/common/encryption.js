'use strict';

const
  AWS = require('aws-sdk'),
  crypto = require('crypto');

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
function encrypt(data, algorithm, kms, keyName) {
  let params = {
    KeyId: keyName,
    KeySpec: 'AES_256'
  };
  return kms.generateDataKey(params).promise()
    .then(keys => {
      // Create a cipher and encrypt the data
      let cipher = crypto.createCipher(algorithm, keys.Plaintext);
      let encryptedData = cipher.update(JSON.stringify(data), 'uft8', 'base64');
      encryptedData += cipher.final('base64');

      // We want to explicitly wipe the plain text key from memory
      keys.Plaintext = null;

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
function decrypt(encryptedPayload, algorithm, kms) {
  let params = {
    CiphertextBlob: encryptedPayload.key
  };
  return kms.decrypt(params).promise()
    .then(decryptedKey => {
      // Create a decipher and decrypt the data
      let decipher = crypto.createDecipher(algorithm, decryptedKey);
      let decryptedData = decipher.update(encryptedPayload.data, 'base64', 'utf8');
      decryptedData += decipher.final('utf8');

      // We want to explicitly wipe the plain text key from memory
      decryptedKey = null;

      return JSON.parse(decryptedData);
    });
}
