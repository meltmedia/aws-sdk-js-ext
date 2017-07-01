#!/usr/bin/env node

'use strict';

process.env.SUPPRESS_NO_CONFIG_WARNING = 'y';

const
  winston = require('winston'),
  commandLineArgs = require('command-line-args'),
  EncryptionUtil = require('../lib').EncryptionUtil;

const optionDefinitions = [
  { name: 'decrypt', alias: 'd', type: Boolean },
  { name: 'region', type: String, defaultValue: 'us-west-2'},
  { name: 'key', type: String},
  { name: 'data', type: String, defaultOption: true}
];

let options = commandLineArgs(optionDefinitions);

if(!options.key) {
  winston.error('key was not specified (Use --key=<kms-key-alias>');
  process.exit(-1);
}

if(!options.data) {
  winston.error('data was not specified');
  process.exit(-1);
}

let encryptionUtil = new EncryptionUtil({
  key: options.key,
  kmsOptions: {
    region: options.region
  }
});

if(options.decrypt) {
  encryptionUtil.decrypt(JSON.parse(options.data))
    .then(decData => console.log(JSON.stringify(decData)))
    .catch(err => {
      winston.error(err);
      process.exit(-1);
    });
} else {
  encryptionUtil.encrypt(JSON.parse(options.data))
    .then(encData => console.log(JSON.stringify(encData)))
    .catch(err => {
      winston.error(err);
      process.exit(-1);
    });
}

