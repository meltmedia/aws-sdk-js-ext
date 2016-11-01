"use strict";

require('../../init-chai');

const
  error = require('../../../lib/common/error'),
  ValidationUtil = require('../../../lib/common/validation'),
  sinon = require('sinon');

describe('ValidationUtil', () => {
  let validationUtil;

  beforeEach(() => {
    validationUtil = new ValidationUtil();
  });

  describe('validate', () => {

    it('should validate successfully for valid data', () => {
      return validationUtil.validate({}, {"id": "#test", "type": "object"}).should.be.fulfilled;
    });

    it('should fail to validate for invalid data', () => {
      return validationUtil.validate({}, {"id": "#test", "type": "array"})
        .should.be.rejectedWith(error.ValidationError);
    });

  });
});
