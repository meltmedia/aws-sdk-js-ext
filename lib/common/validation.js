"use strict";

// Dependencies
const
  _ = require('lodash'),
  ZSchema = require('z-schema'),
  error = require('./error'),
  config = require('config');

// Constants
const
  DEFAULT_AWS_EXT_CONFIG = {
    schema: {
      options: {}
    }
  },
  DEFAULT_VALIDATOR = new ZSchema(_.merge(DEFAULT_AWS_EXT_CONFIG, config.awsext).schema.options);

/**
 * Utility class (promise based) for performing validation against JSON schema
 */
class ValidationUtil {

  /**
   * @param {ZSchema} validator - ZSchema validator instance
   */
  constructor(validator) {
    this.validator = validator || DEFAULT_VALIDATOR;
    //this._validate = promisify(validator.validate);
  }

  _validate(data, schema, options) {
    return new Promise((resolve, reject) => {
      this.validator.validate(data, schema, options, (error => {
        if (!error) {
          resolve();
        }
        else {
          reject(error);
        }
      }))
    });
  }

  /**
   * Validates data against the schema
   * @param {Object} data - Data to be validated
   * @param {Object} schema - Parsed schema object
   * @returns {Promise} Promise that resolves after successful validation
   */
  validate(data, schema) {
    return this._validate(data, schema, {})
      .catch(err => {
        if(err instanceof  Error) {
          throw err
        }
        throw new error.ValidationError((schema || {}).id, error);
      });
  }

}

/**
 *
 * @type {{ValidationUtil: ValidationUtil, ValidationError: ValidationError}}
 */
module.exports = ValidationUtil;