"use strict";

require('../../init-chai');

const
  error = require('../../../lib/common/error'),
  EncryptionUtil = require('../../../lib/common/encryption'),
  commonUtils = require('../../../lib/common/utils'),
  CryptoJS = require('crypto-js'),
  SqsBase = require('../../../lib/sqs').SqsBase,
  sinon = require('sinon'),
  chai = require("chai"),
  expect = chai.expect;

const
  MOCK_QUEUE_URL = 'http://MockQueueUrl';

const
  encryptFixture = require('../fixtures/encryption-fixture');

describe('SqsBase', () => {
  let sqsBase, sqs, kms, conf, encryption;

  before(() => {
    sinon.stub(commonUtils, 'wait').returns(Promise.resolve());
  });

  after(() => {
    commonUtils.wait.restore();
  });

  beforeEach(() => {
    sqs = {
      createQueue: sinon.stub().returns({
        promise: () => Promise.resolve({QueueUrl: MOCK_QUEUE_URL})
      }),
      getQueueUrl: sinon.stub().returns({
        promise: () => Promise.resolve({QueueUrl: MOCK_QUEUE_URL})
      }),
      sendMessage: sinon.stub().returns({
        promise: () => Promise.resolve()
      }),
      deleteQueue: sinon.stub().returns({
        promise: () => Promise.resolve()
      }),
      purgeQueue: sinon.stub().returns({
        promise: () => Promise.resolve()
      })
    };
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
    conf = {
      encryption: {
        key: 'Key Name'
      }
    };

    sqsBase = new SqsBase({sqs: sqs, encryptionUtil: encryption});
  });



  describe('init', () => {
    it('should initialize queue url for existing queue', () => {
      return sqsBase._init().then(() => {
        expect(sqsBase._queueUrl).not.be.null;
        sqsBase._queueUrl.should.be.equal(MOCK_QUEUE_URL);
      });
    });

    it('should initialize queue url for non existing queue', () => {
      const error = new Error('MockError');
      error.code = 'AWS.SimpleQueueService.NonExistentQueue';
      sqs.getQueueUrl.returns({ promise: () => Promise.reject(error) });
      return sqsBase._init().then(() => {
        expect(sqsBase._queueUrl).should.not.be.null;
        sqsBase._queueUrl.should.be.equal(MOCK_QUEUE_URL);
      });
    });

    it('should fail to initialize queue getQueueUrl when AWS Call fails for getQueueUrl', () => {
      const mockError = new Error('MockError');
      sqs.getQueueUrl.returns({ promise: () => Promise.reject(mockError) });
      return sqsBase._init().catch((error) => {
        expect(sqsBase._queueUrl).be.null;
        error.should.be.equal(mockError);
      });
    });

    it('should fail to initialize queue getQueueUrl when AWS Call fails for createQueue', () => {
      const mockNonExistingError = new Error('MockNonExistingQueueError');
      mockNonExistingError.code = 'AWS.SimpleQueueService.NonExistentQueue';
      sqs.getQueueUrl.returns({ promise: () => Promise.reject(mockNonExistingError) });

      const mockCreateQueueError = new Error('MockCreateQueueError');
      sqs.createQueue.returns({ promise: () => Promise.reject(mockCreateQueueError) });


      return sqsBase._init().catch((error) => {
        expect(sqsBase._queueUrl).be.null;
        error.should.be.equal(mockCreateQueueError);
      });
    });

    it('should not re-initialize queue url', () => {
      sqsBase._queueUrl = MOCK_QUEUE_URL;
      return sqsBase._init().then(() => {
        expect(sqsBase._queueUrl).be.equal(MOCK_QUEUE_URL);
        sqs.getQueueUrl.should.not.be.called;
        sqs.createQueue.should.not.be.called;
      });
    });

  });

  describe('validateMessage', () => {
    it('should validate message when schema is defined', () => {
      let msgData = {
        "test": "test"
      };
      return sqsBase.validateMessage(msgData).should.eventually.deep.equals(msgData);
    });

    it('should fail validation when data is invalid', () => {
      let msgData = [];
      return sqsBase.validateMessage(msgData).should.eventually.be.rejected;
    });

    it('should skip validation when schema is not defined', () => {
      let msgData = [];
      sqsBase.conf.schema = undefined;
      return sqsBase.validateMessage(msgData).should.eventually.be.fulfilled;
    });
  });

  describe('sendMessage', () => {
    it('should validate and send message', () => {
      let msgData = {
        "test": "test"
      };
      return sqsBase.sendMessage(msgData).then(() => {
        return sqs.sendMessage.args[0][0].should.eql({
          MessageBody: JSON.stringify(msgData),
          QueueUrl: MOCK_QUEUE_URL
        });
      });
    });

    it('should validate and encrypt message', () => {
      let msgData = { test: 'test' };
      let encryptedPayload = { encrypted: encryptFixture.ENCRYPTED_PAYLOAD};

      return sqsBase.sendMessage(msgData, encryptFixture.DATA).then(() => {
        let message = sqs.sendMessage.args[0][0];
        let messageBody = JSON.parse(message.MessageBody);
        messageBody.should.have.property('encrypted');

        // Decrypt and check that it's the same as the original data
        let bytes = CryptoJS.AES.decrypt(messageBody.encrypted.data, encryptFixture.PLAINTEXT_KEY);
        let decryptedData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
        return decryptedData.should.eql(encryptFixture.DATA);
      });
    });
  });

  describe('_encrypt()', () => {
    let encryptStub, data, promise;

    before(() => {
      encryptStub = sinon.stub(encryption, 'encrypt').resolves();
      promise = sqsBase._encrypt(encryptFixture.DATA);
    });

    after(() => {
      encryptStub.restore();
    });

    it('it calls encryptionUtil.encrypt() with the correct arguments', () => {
      return promise.then(() => {
        encryptStub.calledWithExactly(encryptFixture.DATA).should.be.true;
      });
    });
  });

  describe('_decrypt()', () => {
    let decryptStub, payload, promise;

    before(() => {
      decryptStub = sinon.stub(encryption, 'decrypt').resolves();
      promise = sqsBase._decrypt(encryptFixture.ENCRYPTED_PAYLOAD);
    });

    after(() => {
      decryptStub.restore();
    });

    it('it calls encryptionUtil.decrypt() with the correct arguments', () => {
      return promise.then(encryptedData => {
        decryptStub.calledWith(encryptFixture.ENCRYPTED_PAYLOAD).should.be.true;
      });
    });
  });

  describe('deleteQueue', () => {

    it('should delete the initialized queue', () => {
      sqsBase._queueUrl = MOCK_QUEUE_URL;

      return sqsBase.deleteQueue().then(() => {
        expect(sqsBase._queueUrl).to.be.null;
        sqs.deleteQueue.should.be.calledWithExactly({
          QueueUrl: MOCK_QUEUE_URL
        });
      });
    });

    it('should not delete the non initialized queue', () => {
      return sqsBase.deleteQueue().then(() => {
        expect(sqsBase._queueUrl).to.be.null;
        sqs.deleteQueue.should.not.be.called;
      });
    });


  });

  describe('purgeQueue', () => {

    it('should purge message from the queue', () => {
      sqsBase._queueUrl = MOCK_QUEUE_URL;

      return sqsBase.purgeQueue().then(() => {
        sqs.purgeQueue.should.be.calledWithExactly({
          QueueUrl: MOCK_QUEUE_URL
        });
      });
    });


  });
});
