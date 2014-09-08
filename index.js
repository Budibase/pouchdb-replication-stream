'use strict';

var utils = require('./pouch-utils');
var version = require('./version');
var split = require('split');
var through = require('through2').obj;

var DEFAULT_BATCH_SIZE = 1; // one doc per line

exports.adapters = {};
exports.adapters.writableStream = require('./writable-stream');

exports.plugin = {};

exports.plugin.dump = utils.toPromise(function (writableStream, opts, callback) {
  var self = this;
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }

  var PouchDB = self.constructor;

  var output = new PouchDB(self._db_name, {
    stream: writableStream,
    adapter: 'writableStream'
  });

  self.info().then(function (info) {
    var header = {
      version: version,
      db_type: self.type(),
      start_time: new Date().toJSON(),
      db_info: info
    };
    writableStream.write(JSON.stringify(header) + '\n');
  }).then(function () {
    var replicationOpts = {
      batch_size: ('batch_size' in opts ? opts.batch_size: DEFAULT_BATCH_SIZE)
    };
    return self.replicate.to(output, replicationOpts);
  }).then(function () {
    return output.close();
  }).then(function () {
    callback(null, {ok: true});
  }).catch(function (err) {
    callback(err);
  });
});

exports.plugin.load = utils.toPromise(function (readableStream, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }

  var queue = [];
  readableStream.pipe(split()).pipe(through(function (line, _, next) {
    if (!line) {
      return next();
    }
    var data = JSON.parse(line);
    if (!data.docs) {
      return next();
    }
    // lets smooth it out
    data.docs.forEach(function (doc) {
      this.push(doc);
    }, this);
    next();
  }))
  .pipe(through(function (doc, _, next) {
    queue.push(doc);
    if (queue.length > 50) {
      this.push(queue);
      queue = [];
    }
    next();
  }, function (next) {
    if (queue.length) {
      this.push(queue);
    }
    next();
  }))
  .pipe(this.createWriteStream({newEdits: false}))
  .on('error', callback)
  .on('finish', function () {
    callback();
  });
});

/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  window.PouchDB.plugin(exports.plugin);
  window.PouchDB.adapter('writableStream', exports.adapters.writableStream);
  window.PouchDB.plugin(require('pouch-stream'));
}