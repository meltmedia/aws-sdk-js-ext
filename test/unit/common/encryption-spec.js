"use strict";

require('../../init-chai');

/* jshint expr: true */

const
  crypto = require('crypto'),
  encryption = require('../../../lib/common/encryption'),
  KMS = require('aws-sdk').KMS,
  sinon = require('sinon');

/*
  All constants relating to encrypting data. DATA was encrypted into ENCRYPTED_DATA with the key PLAINTEXT_KEY using
  the ALGORITHM. If any of these constants need to change, the values need to be recomputed. CIPHERTEXT_KEY is not
  dependent on any of the other settings, and does not need to be recomputed.
*/
const
  ALGORITHM = 'aes-256-ecb',
  CIPHERTEXT_KEY = 'ciphertext',
  DATA = {key: 'test key', value: 'test value'},
  ENCRYPTED_DATA = 'o9w7+YNBLNpmlzIBIL06Gf0bpy7xgn7s3EpCJvh3pPHGaNehTNv111UU9a0Bmvhl',
  PLAINTEXT_KEY = '00000000001111111111222222222233';

describe('Encryption', () => {
  let kms;

  before(() => {
    kms = {
      generateDataKey: sinon.stub().returns({
        promise: () => Promise.resolve({Plaintext: PLAINTEXT_KEY, CiphertextBlob: CIPHERTEXT_KEY})
      }),
      decrypt: sinon.stub().returns({
        promise: () => Promise.resolve(PLAINTEXT_KEY)
      })
    };
  });

  describe('encrypt()', () => {
    let promise;

    before(() => {
      promise = encryption.encrypt(DATA, ALGORITHM, kms, 'KeyName');
    });

    it('calls KMS.generateDataKey() with the correct arguments', () => {
      let argument = { KeyId: 'KeyName', KeySpec: 'AES_256' };
      return promise.then(payload => {
        kms.generateDataKey.args[0][0].should.eql(argument);
      });
    });

    describe('the return object', () => {
      it('has the correct properties', () => {
        return promise.then(payload => {
          payload.should.have.all.keys(['data', 'key']);
        });
      });

      it('has the correct encrypted data', () => {
        return promise.then(payload => {
          payload.data.should.eql(ENCRYPTED_DATA);
        });
      });

      it('has the key used for encryption', () => {
        return promise.then(payload => {
          payload.key.should.eql(CIPHERTEXT_KEY);
        });
      });
    });
  });

  describe('decrypt()', () => {
    let payload, promise;

    before(() => {
      payload = {data: ENCRYPTED_DATA, key: CIPHERTEXT_KEY};
      promise = encryption.decrypt(payload, ALGORITHM, kms);
    });

    it('calls KMS.decrypt() with the correct arguments', () => {
      let argument = {CiphertextBlob: CIPHERTEXT_KEY};
      return promise.then(payload => {
        kms.decrypt.args[0][0].should.eql(argument);
      });
    });

    it('returns the correct decrypted data', () => {
      return promise.then(decryptedData => {
        decryptedData.should.eql(DATA);
      });
    });
  });
});
