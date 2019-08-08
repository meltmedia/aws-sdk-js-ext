const gulp = require('gulp'),
  gutil = require('gulp-util'),
  spawnMocha = require('gulp-spawn-mocha'),
  plugins = require('gulp-load-plugins')();

const TEST_TIMEOUT = 60000;

const paths = {
  lint: ['./*.js', './lib/**/*.js', './test/**/*.js'],
  watch: ['./lib/**/*.js', './test/**/*.js'],
  tests: {
    unit: ['./test/unit/**/*-spec.js'],
    integration: ['./test/integration/**/*-spec.js'],
    functional: ['./test/functional/**/*-spec.js']
  },
  source: ['./lib/**/*.js']
};

const istanbulOpts = {
  print: 'both',
  'include-all-sources': true
};

gulp.task('lint', () => {
  return gulp.src(paths.lint)
    .pipe(plugins.jshint())
    .pipe(plugins.jshint.reporter('jshint-stylish'))
    .pipe(plugins.jshint.reporter('fail'));
});

gulp.task('coverage', () => {
  return gulp.src(paths.tests.unit.concat(paths.tests.integration))
    .pipe(spawnMocha({
      timeout: TEST_TIMEOUT,
      istanbul: istanbulOpts
    }))
    .on('error', gutil.log);
});

gulp.task('coveralls', ['coverage'], () => {
  return gulp.src('coverage/**/lcov.info')
    .pipe(plugins.coveralls());
});

gulp.task('test:unit', () => {
  return gulp.src(paths.tests.unit, { read: false })
    .pipe(spawnMocha({
      istanbul: istanbulOpts
    }))
    .on('error', gutil.log);
});

gulp.task('test:integration', () => {
  return gulp.src(paths.tests.integration, { read: false })
    .pipe(spawnMocha({
      timeout: TEST_TIMEOUT,
      istanbul: istanbulOpts
    }))
    .on('error', gutil.log);
});

gulp.task('test:functional', () => {
  return gulp.src(paths.tests.functional, { read: false })
    .pipe(spawnMocha({
      timeout: TEST_TIMEOUT,
      istanbul: istanbulOpts
    }))
    .on('error', gutil.log);
});

gulp.task('test:unit-watch', () => {
  gulp.watch(paths.watch, ['test:unit']);
});


gulp.task('test', ['coverage']);
gulp.task('travis', ['lint', 'test']);
gulp.task('default', ['lint', 'test']);