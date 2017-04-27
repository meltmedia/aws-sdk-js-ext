"use strict";

require('../../init-chai');

const
  error = require('../../../lib/common/error'),
  encryption = require('../../../lib/common/encryption'),
  commonUtils = require('../../../lib/common/utils'),
  SqsBase = require('../../../lib/sqs/sqs-base'),
  _ = require('lodash'),
  sinon = require('sinon'),
  chai = require("chai"),
  expect = chai.expect;

const
  MOCK_QUEUE_URL = 'http://MockQueueUrl';

const
  encryptFixture = require('../fixtures/encryption-fixture');

describe('SqsBase', () => {
  let sqsBase, sqs, schemaService, kms, conf;

  before(() => {
    sqs = {
      createQueue: sinon.stub().returns({
        promise: () => Promise.resolve({QueueUrl: MOCK_QUEUE_URL})
      }),
      getQueueUrl: sinon.stub().returns({
        promise: () => Promise.resolve({QueueUrl: MOCK_QUEUE_URL})
      }),
      sendMessage: sinon.stub().returns({
        promise: () => Promise.resolve()
      })
    };
    kms = {
      generateDataKey: sinon.stub().returns({
        promise: () => Promise.resolve({Plaintext: encryptFixture.PLAINTEXT_KEY, CiphertextBlob: encryptFixture.CIPHERTEXT_KEY})
      }),
      decrypt: sinon.stub().returns({
        promise: () => Promise.resolve(encryptFixture.PLAINTEXT_KEY)
      })
    };
    conf = {
      encryption: {
        algorithm: encryptFixture.ALGORITHM,
        key: 'Key Name'
      }
    };
    sinon.stub(commonUtils, 'wait').returns(Promise.resolve());
    sqsBase = new SqsBase({sqs: sqs, kms: kms, conf: conf});
  });

  afterEach(() => {
    sqs.createQueue.resetHistory();
    sqs.getQueueUrl.resetHistory();
    sqs.sendMessage.resetHistory();

    sqsBase._encryption = conf.encryption;
  });

  after(() => {
    commonUtils.wait.restore();
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
        sqs.sendMessage.args[0][0].should.eql({
          MessageBody: JSON.stringify(_.merge({}, msgData, encryptedPayload)),
          QueueUrl: MOCK_QUEUE_URL
        });
      });
    });

    it('should throw an EncryptionConfigurationError if encryption config is not found', () => {
      sqsBase._encryption = undefined;

      let msgData = { test: 'test' };
      return sqsBase.sendMessage(msgData, encryptFixture.DATA).should.rejectedWith(error.EncryptionConfigurationError);
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

    it('it calls encryption.encrypt() with the correct arguments', () => {
      return promise.then(encryptedData => {
        encryptStub.calledWithExactly(encryptFixture.DATA, conf.encryption.algorithm, kms, conf.encryption.key);
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

    it('it calls encryption.decrypt() with the correct arguments', () => {
      return promise.then(encryptedData => {
        decryptStub.calledWithExactly(encryptFixture.ENCRYPTED_PAYLOAD, conf.encryption.algorithm, kms);
      });
    });
  });
});
