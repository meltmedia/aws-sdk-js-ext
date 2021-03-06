"use strict";

require('../../init-chai');

/* jshint expr: true */

const
  CryptoJS = require('crypto-js'),
  encryptFixture = require('../fixtures/encryption-fixture'),
  EncryptionUtil = require('../../../lib/common/encryption'),
  KMS = require('aws-sdk').KMS,
  sinon = require('sinon');

describe('EncryptionUtil', () => {
  let encryption, kms;

  before(() => {
    kms = {
      generateDataKey: sinon.stub().returns({
        promise: () => Promise.resolve({
          Plaintext: Buffer.from(encryptFixture.PLAINTEXT_KEY, 'hex'),
          CiphertextBlob: Buffer.from(encryptFixture.CIPHERTEXT_KEY, 'hex')
        })
      }),
      decrypt: sinon.stub().returns({
        promise: () => Promise.resolve({
          Plaintext: Buffer.from(encryptFixture.PLAINTEXT_KEY, 'hex')
        })
      })
    };
    encryption = new EncryptionUtil({key: 'Key Name'}, kms);
  });

  describe('encrypt()', () => {
    let promise;

    before(() => {
      promise = encryption.encrypt(encryptFixture.DATA);
    });

    it('calls KMS.generateDataKey() with the correct arguments', () => {
      let argument = { KeyId: 'Key Name', KeySpec: 'AES_256' };
      return promise.then(payload => {
        kms.generateDataKey.args[0][0].should.eql(argument);
      });
    });

    it('returns a different encrypted data string on consecutive encrypts', () => {
      return promise.then(payload => {
        return encryption.encrypt(encryptFixture.DATA)
          .then(otherPayload => {
            payload.data.should.not.equal(otherPayload.data);
          });
      });
    });

    it('should throw error when encryption key not set', () => {
      return new EncryptionUtil()
        .encrypt(encryptFixture.DATA)
        .should.eventually.be.rejectedWith(Error);
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
    it('decrypts the valid encrypted payload', () => {
      return encryption.decrypt(encryptFixture.ENCRYPTED_PAYLOAD)
        .then(decryptedData => {
          decryptedData.should.eql(encryptFixture.DATA);
      });
    });

    it('throws TypeError if data to be decrypted is not valid', () => {
      return encryption.decrypt({
        data: 'invalid data',
        key: encryptFixture.ENCRYPTED_PAYLOAD.key
      }).should.be.eventually.rejectedWith(TypeError);
    });

    it('throws TypeError if decrypted data is invalid JSON', () => {
      return encryption.decrypt({
        data: CryptoJS.AES.encrypt('invalid json',encryptFixture.PLAINTEXT_KEY).toString(),
        key: encryptFixture.ENCRYPTED_PAYLOAD.key
      }).should.be.eventually.rejectedWith(TypeError);
    });

  });
});
