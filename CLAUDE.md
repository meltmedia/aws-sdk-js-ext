# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Testing

- `npm test` or `gulp test` - Run all tests with coverage (unit + integration tests)
- `gulp test:unit` - Run unit tests only
- `gulp test:integration` - Run integration tests only  
- `gulp test:functional` - Run functional tests (requires elasticmq on localhost:9324)
- `gulp test:unit-watch` - Watch mode for unit tests

### Build & Quality

- `gulp lint` - Run JSHint linting on all JavaScript files
- `gulp coverage` - Generate test coverage report
- `gulp travis` - Run linting and tests (CI pipeline)
- `gulp` (default) - Run linting and tests

## Architecture Overview

This is an AWS SDK JavaScript extension library focused primarily on SQS (Simple Queue Service) functionality. The architecture follows a modular design:

### Core Components

**Main Entry Point**: `lib/index.js` - Exports all major modules including SQS, error handling, utilities, encryption, and validation.

**SQS Module** (`lib/sqs/`):

- `SqsBase` - Base class providing core SQS functionality including queue initialization, message validation, encryption/decryption, and basic operations
- `SqsConsumer` - Extends SqsBase with polling, message processing, retry logic with exponential backoff, and scheduled consumption capabilities
- `index.js` - Exports both SQS classes

**Common Utilities** (`lib/common/`):

- `utils.js` - Contains `Retrier` class for exponential backoff retry logic and utility functions
- `encryption.js` - `EncryptionUtil` class for KMS-based encryption/decryption with AES-256
- `validation.js` - JSON schema validation utilities
- `error.js` - Custom error classes for different error types

### Key Architectural Patterns

**Configuration Management**: Uses hierarchical configuration merging with defaults from `config` package, allowing environment-specific overrides.

**Event-Driven Design**: Both SqsBase and SqsConsumer extend EventEmitter, emitting events for initialization, message processing, failures, etc.

**Error Classification**: Distinguishes between retryable and non-retryable errors (ValidationError, NonRetryableError, SyntaxError) to determine retry behavior.

**Message Encryption**: Optional transparent encryption/decryption of sensitive message data using AWS KMS with AES-256.

**Retry Logic**: Implements exponential backoff with configurable parameters for both message processing retries and polling error handling.

**Scheduled Processing**: SqsConsumer supports scheduled consumption windows with visibility timeout management.

## Configuration

The library uses a hierarchical configuration system:

- Default configurations in code
- `config` package for environment-specific settings  
- Constructor options override defaults
- Queue-specific configurations in `awsext.sqs[queueName]`

## CLI Tools

The library provides a standalone CLI tool in `bin/encrypt.js` for encrypting/decrypting payloads using KMS keys.

## Dependencies

Key dependencies include AWS SDK v2, lodash for utilities, winston for logging, moment for date handling, and crypto-js for encryption operations.