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
  MOCK_QUEUE_URL = 'http://MockQueueUrl',
  DATA = {key: 'test key', value: 'test value'},
  ENCRYPTED_DATA = 'o9w7+YNBLNpmlzIBIL06Gf0bpy7xgn7s3EpCJvh3pPHGaNehTNv111UU9a0Bmvhl',
  PLAINTEXT_KEY = '00000000001111111111222222222233',
  CIPHERTEXT_BLOB = 'ciphertext blob';

describe('SqsConsumer', () => {
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
        promise: () => Promise.resolve({Plaintext: PLAINTEXT_KEY, CiphertextBlob: CIPHERTEXT_BLOB})
      }),
      decrypt: sinon.stub().returns({
        promise: () => Promise.resolve(PLAINTEXT_KEY)
      })
    };
    conf = {
      encryption: {
        algorithm: 'aes-256-ecb',
        key: 'key name'
      }
    };
    sinon.stub(commonUtils, 'wait').returns(Promise.resolve());
    sqsBase = new SqsBase({sqs: sqs, kms: kms, conf: conf}, msgBody => Promise.resolve());
  });

  afterEach(() => {
    sqs.createQueue.resetHistory();
    sqs.getQueueUrl.resetHistory();
    sqs.sendMessage.resetHistory();
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
      let msgToEncrypt = { myKey: 'encrypt this pls' };
      let encryptedPayload = { encrypted: { data: 'pdIDQFVoW+wVRzAGNPEfl2upzFizbStRhxSXauZPl8c=', key: CIPHERTEXT_BLOB }};

      return sqsBase.sendMessage(msgData, msgToEncrypt).then(() => {
        sqs.sendMessage.args[0][0].should.eql({
          MessageBody: JSON.stringify(_.merge({}, msgData, encryptedPayload)),
          QueueUrl: MOCK_QUEUE_URL
        });
      });
    });
  });

  describe('_encrypt()', () => {
    let encryptStub, data, promise;

    before(() => {
      encryptStub = sinon.stub(encryption, 'encrypt').resolves();
      promise = sqsBase._encrypt(DATA);
    });

    it('it calls encryption.encrypt() with the correct arguments', () => {
      return promise.then(encryptedData => {
        encryptStub.calledWithExactly(DATA, conf.encryption.algorithm, kms, conf.encryption.key);
      });
    });
  });

  describe('_decrypt()', () => {
    let decryptStub, payload, promise;

    before(() => {
      decryptStub = sinon.stub(encryption, 'decrypt').resolves();
      payload = {data: ENCRYPTED_DATA, key: PLAINTEXT_KEY};
      promise = sqsBase._decrypt(payload);
    });

    it('it calls encryption.decrypt() with the correct arguments', () => {
      return promise.then(encryptedData => {
        decryptStub.calledWithExactly(payload, conf.encryption.algorithm, kms);
      });
    });
  });
});
