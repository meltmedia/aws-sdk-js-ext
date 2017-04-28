"use strict";

require('../../init-chai');

/* jshint expr: true */

const
  CryptoJS = require('crypto-js'),
  encryptFixture = require('../fixtures/encryption-fixture'),
  encryption = require('../../../lib/common/encryption'),
  KMS = require('aws-sdk').KMS,
  sinon = require('sinon');

describe('Encryption', () => {
  let kms;

  before(() => {
    kms = {
      generateDataKey: sinon.stub().returns({
        promise: () => Promise.resolve({
          Plaintext: encryptFixture.PLAINTEXT_KEY,
          CiphertextBlob: encryptFixture.CIPHERTEXT_KEY
        })
      }),
      decrypt: sinon.stub().returns({
        promise: () => Promise.resolve(encryptFixture.PLAINTEXT_KEY)
      })
    };
  });

  describe('encrypt()', () => {
    let promise;

    before(() => {
      promise = encryption.encrypt(encryptFixture.DATA, kms, 'KeyName');
    });

    it('calls KMS.generateDataKey() with the correct arguments', () => {
      let argument = { KeyId: 'KeyName', KeySpec: 'AES_256' };
      return promise.then(payload => {
        kms.generateDataKey.args[0][0].should.eql(argument);
      });
    });

    it('returns a different encrypted data string on consecutive encrypts', () => {
      return promise.then(payload => {
        return encryption.encrypt(encryptFixture.DATA, kms, 'KeyName')
          .then(otherPayload => {
            payload.data.should.not.equal(otherPayload.data);
          });
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
          // Decrypt and check that it's the same as the original data
          let bytes = CryptoJS.AES.decrypt(payload.data, encryptFixture.PLAINTEXT_KEY);
          let decryptedData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
          decryptedData.should.eql(encryptFixture.DATA);
        });
      });

      it('has the key used for encryption', () => {
        return promise.then(payload => {
          payload.key.should.eql(encryptFixture.CIPHERTEXT_KEY);
        });
      });
    });
  });

  describe('decrypt()', () => {
    let payload, promise;

    before(() => {
      promise = encryption.decrypt(encryptFixture.ENCRYPTED_PAYLOAD, kms);
    });

    it('calls KMS.decrypt() with the correct arguments', () => {
      let argument = {CiphertextBlob: encryptFixture.CIPHERTEXT_KEY};
      return promise.then(payload => {
        kms.decrypt.args[0][0].should.eql(argument);
      });
    });

    it('returns the correct decrypted data', () => {
      return promise.then(decryptedData => {
        decryptedData.should.eql(encryptFixture.DATA);
      });
    });
  });
});
