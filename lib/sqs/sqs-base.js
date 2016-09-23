"use strict";

require('promise.prototype.finally');

const
  promisify = require("es6-promisify"),
  config = require("config"),
  _ = require('lodash'),
  winston = require('winston'),
  commonUtils = require('../common/utils'),
  ValidationUtil = require('../common/validation'),
  error = require('../common/error'),
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
          duration: 2 * 60 * 60, // 2hrs
          maxWaitSeconds: 6 * 60 * 60 // 6hrs
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
    this._queueName = this.conf.queue.prefix + this.conf.queue.env;
    this._queueUrl = null; //Initialized using AWS Lookup
    this.validationUtil = options.validationUtil || new ValidationUtil();
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
   * Validates and sends message to queue
   * @param msgData
   */
  sendMessage(msgData) {
    return this._init()
      .then( () => this.validateMessage(msgData))
      .then( () => this._sqs.sendMessage ({
        MessageBody: JSON.stringify(msgData),
        QueueUrl: this._queueUrl,
      }).promise())
      .then ( () => {
        this.emit('sent', msgData);
      })
      .catch ( err => {
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
}

module.exports = SqsBase;
