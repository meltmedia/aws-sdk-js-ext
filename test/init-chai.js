"use strict";

/*jshint -W117 */

const chai = require('chai'),
  chaiAsPromised = require("chai-as-promised").default,
  sinonChai = require("sinon-chai").default;

chai.config.truncateThreshold = 0;
chai.config.showDiff = true;
chai.config.includeStack = true;
chai.should();
chai.use(sinonChai);
chai.use(chaiAsPromised);
