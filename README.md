# aws-sdk-js-ext
AWS SDK Javascript Extensions
This library provides extensions to AWS SDK Javascript to provide ease of use for certain functionality like:
- SQS Message Handling


## Requirements
This library is intended to be used on server side.

- Node (6.3+) `nvm install; nvm use;`

## Requirements (dev)
Here are additional requirements for development:
- gulp-cli ``` npm install gulp-cli ```

## Installation
To install latest development version run:
```
npm install --save https://github.com/meltmedia/aws-sdk-js-ext/tarball/develop
```

To install latest release version run:
```
npm install --save https://github.com/meltmedia/aws-sdk-js-ext/tarball/master
```

## API Documentation
This is WIP. At the moment you can have a look at following examples for usage:

- [SQS Consumer](examples/sqs/sqs-consumer.js)

## Scripts
The extensions library also provides scripts to be used from standalone.

### Installation
You can install the library globally to use these utility scripts
```
npm install -g https://github.com/meltmedia/aws-sdk-js-ext/tarball/develop
```

### Pre-Requisites
In order to use the scripts ensure that following environment variables are set:

- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY


### Encrypt
This CLI utility allows you to encrypt / decrypt messages using KMS. 

In order to encrypt JSON payload , use command:

```
encrypt --region=us-west-2 --key='alias/example' '{"testKey1": "test value 1", "testKey2": "test value 2"}'
```

This command will print the encrypted JSON payload.

In order to decrypt encrypted JSON payload , use command:

```
encrypt --region=us-west-2 --key='alias/example' -d '{"data": "<encrypted-data-base64-format>", "key": "<encrypted-key-hex-format>"}'
```


## Release
This project uses gitflow for release.

### Functional Tests

Currently these tests are not in a ideal state, hopefully they will be updated later. 

To execute the functional tests you will need [elasticmq](https://github.com/softwaremill/elasticmq) running on http://localhost:9324

Then run:

```
gulp test:functional
```



