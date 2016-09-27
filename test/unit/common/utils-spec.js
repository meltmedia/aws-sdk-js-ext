"use strict";

require('../../init-chai');

const
  commonUtils = require('../../../lib/common/utils'),
  sinon = require('sinon');

describe('utils', () => {

  describe('nextRetryInterval', () => {

    it('should calculate next retry interval', () => {
      commonUtils.nextRetryInterval(3).should.be.equal(68);
    });

    it('should limit max interval', () => {
      commonUtils.nextRetryInterval(10).should.be.equal(600);
    });

  });

  describe('wait', () => {
    let clock;

    before(() => {
      clock = sinon.useFakeTimers();
    });

    after(() => {
      clock.restore();
    });

    it('should wait for given duration', () => {
      let waitPromise =  commonUtils.wait(1000);
      clock.tick(1000);
      return waitPromise.should.be.fulfilled;
    });
  });

  describe('getVisibilityTimeout', () => {
    it('returns a value clamped at the max', () => {
      commonUtils.getVisibilityTimeout(2000, 1000).should.equal(1000);
    });

    it('returns any value below max', () => {
      commonUtils.getVisibilityTimeout(2000, 60000).should.equal(2000);
    });
  });
});
