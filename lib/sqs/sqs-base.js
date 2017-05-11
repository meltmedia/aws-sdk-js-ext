"use strict";

require('promise.prototype.finally');

const
  promisify = require('es6-promisify'),
  config = require('config'),
  _ = require('lodash'),
  winston = require('winston'),
  commonUtils = require('../common/utils'),
  ValidationUtil = require('../common/validation'),
  error = require('../common/error'),
  EncryptionUtil = require('../common/encryption'),
  events = require('events'),
  AWS = require('aws-sdk');

const DEFAULT_BASE_AWS_EXT_CONFIG = {
  sqs: {
    defaults: {
      queue: {
        env: process.env.USER, // Use current user as environment
        prefix: 'sqs-default-',
        attributes: {}
      },
      sqsOptions: {
        region: 'us-west-2'
      },
      consumer: {
        scheduler: {
          scheduled: false,
          start: '00:00:00',
          duration: '2 hours',
          maxVisibilityTimeout: '6 hours'
        }
      },
      schema: {
        "$schema": "http://json-schema.org/draft-04/schema#",
        type: "object"
      }
    }
  }
};

/**
 * SQS Base class for initializing and config management
 * - message parsing (JSON)
 * - validation
 * - Retries and Polling
 * - API Methods to get status and control consumer
 */
class SqsBase extends events.EventEmitter {

  constructor(options, defaultAwsExtConfig) {
    super();
    options = options || {};
    this.name = options.name || 'sqs-default';

    let awsext = _.merge({}, DEFAULT_BASE_AWS_EXT_CONFIG, defaultAwsExtConfig, config.awsext);
    this.conf = _.merge({}, awsext.sqs.defaults, awsext.sqs[this.name], options.conf);
    this._sqs = options.sqs || new AWS.SQS(this.conf.sqsOptions);
    this._kms = options.kms || new AWS.KMS(this.conf.kmsOptions);
    this._queueName = this.conf.queue.prefix + this.conf.queue.env;
    this._queueUrl = null; //Initialized using AWS Lookup
    this.validationUtil = options.validationUtil || new ValidationUtil();
    this.encryptionUtil = options.encryptionUtil || new EncryptionUtil(this.conf.encryption, this._kms);
  }

  status() {
    return {
      queueName: this._queueName,
      queueUrl: this._queueUrl
    };
  }

  get sqs() {
    return this._sqs;
  }

  /**
   * Validates message that needs to be sent / received from queue
   * @param msgData
   * @returns {*}
   */
  validateMessage(msgData) {
    if(this.conf.schema) {
      return this.validationUtil.validate(msgData, this.conf.schema).then(() => {
        return msgData;
      });
    }
    return Promise.resolve(msgData);
  }

  /**
   * Deletes the associated queue (during testing)
   */
  deleteQueue() {
    if(this._queueUrl) {
      return this.sqs.deleteQueue({QueueUrl: this._queueUrl})
        .promise()
        .then(resp => {
          winston.info(`SqsBase::${this.name}::Deleted Queue:${this._queueUrl}`);
          this._queueUrl = null;
          return resp;
        });
    }
    return Promise.resolve();
  }

  /**
   * Purges messages from the queue
   */
  purgeQueue() {
    return this._init()
      .then(() => this.sqs.purgeQueue({QueueUrl: this._queueUrl}))
      .then(resp => {
        winston.info(`SqsBase::${this.name}::Purged Queue:${this._queueUrl}`);
        return resp;
      });
  }

  /**
   * Validates and sends message to queue
   * @param {object} msgData - The message to send to the queue
   * @param {object} [sensitiveMsgData] - An optional message to encrypt alongside the original message
   */
  sendMessage(msgData, sensitiveMsgData) {

    return this._init()
      .then(() => {
        if(!_.isEmpty(sensitiveMsgData)) {
          let tempMsg = _.merge({}, msgData, sensitiveMsgData); // create a temp object and validate it before encrypting...

          return this.validateMessage(tempMsg)
            .then(() => this._encrypt(sensitiveMsgData)) // encrypt the message...
            .then(encryptedPayload => _.merge({}, msgData, {encrypted: encryptedPayload})); // and attach it to the message
        }

        // else just validate the normal message
        return this.validateMessage(msgData)
          .then(() => msgData);
      })
      .then(sqsMsg => {
        return this._sqs.sendMessage({
          MessageBody: JSON.stringify(sqsMsg),
          QueueUrl: this._queueUrl,
        }).promise()
        .then(() => {
          this.emit('sent', sqsMsg);
        });
      })
      .catch(err => {
        this.emit('sent-failed', err);
        throw err;
      });
  }

  /**
   * Initializes queue url and optionally creates queue if queue does not exist
   * @returns {*}
   * @private
   */
  _init() {
    if(!this._queueUrl) {
      winston.info(`SqsBase::${this.name}::Using Queue:${this._queueName}`);
      return this._sqs.getQueueUrl({QueueName: this._queueName}).promise()
        .then(resp => {
          this._queueUrl = resp.QueueUrl;
          this.emit('initialized', this._queueUrl);
          winston.info(`SqsBase::${this.name}::Using Queue:`, this._queueUrl);
        }).catch(err => {
          if(err.code && err.code == 'AWS.SimpleQueueService.NonExistentQueue') {
            return this._sqs.createQueue({
              QueueName: this._queueName,
              Attributes: this.conf.queue.attributes
            }).promise().then(data => {
              winston.info(`SqsBase::${this.name}::Created Queue: ${data.QueueUrl}`);
              this._queueUrl = data.QueueUrl;
            });
          }
          throw err;
        }).catch(err => {
          winston.error(err);
          // Failed initialization
          this.emit('failed-init', err);
          throw err;
        });
    }
    return Promise.resolve();
  }

  _encrypt(data) {
    return this.encryptionUtil.encrypt(data);
  }

  _decrypt(encryptedPayload) {
    return this.encryptionUtil.decrypt(encryptedPayload);
  }
}


module.exports = SqsBase;
