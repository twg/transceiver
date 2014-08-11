var _ = require('lodash');
var Q = require('q');
var debug = require('debug')('transceiver:manager:memory');

var paramStringFromParams = function(params) {
  return _.sortBy(_.map(params, function(value, key) {
    return key + ":" + value;
  })).join(":");
};

var doesMatchParams = function(params, compare) {
  //  If the provided params pass all of the filters, return true.
  return _.all(compare.params, function(value, key) { return params[key] === value; });
};

module.exports = Manager;

function Manager() {
  this.collections = {};
}

Manager.prototype._pruneEmptyCollections = function() {
  this.collections = _.reduce(this.collections, function(acc, channels, modelName) {
    var newChannels = _.reduce(channels, function(acc, channel, key) {
      if (channel.listeners.length > 0) {
        acc[key] = channel;
      }
      return acc;
    }, {});

    if (Object.keys(newChannels).length > 0) {
      acc[modelName] = newChannels;
    }
    return acc;
  }, {});
};

/*
 * All of the functions in this CollectionManager object
 * must return promises, as other CollectionManagers may be based on
 * slow network calls - i.e.: to a Redis instance or something.
 * The external interface should remain the same as below.
 */

Manager.prototype.addListener = function(modelName, socketId, paramList) {
  var paramString = paramStringFromParams(paramList);
  var record;

  if (!(modelName in this.collections)) {
    this.collections[modelName] = {};
  }

  if (!(paramString in this.collections[modelName])) {
    record = this.collections[modelName][paramString] = {};
  } else {
    record = this.collections[modelName][paramString];
  }

  record.params = paramList;
  if (!record.listeners) record.listeners = [];
  record.listeners.push(socketId);

  return Q.fcall(function() { return paramString; });
};

Manager.prototype.removeListener = function(modelName, socketId, paramList) {
  var paramString = paramStringFromParams(paramList);
  var promise = Q.fcall(function() { return paramString; });

  if (!(modelName in this.collections)) return promise;
  if (!(paramString in this.collections[modelName])) return promise;

  var record = this.collections[modelName][paramString];
  if (!record) return promise;

  record.listeners = _.filter(record.listeners, function(l) { return l !== socketId; });
  this._pruneEmptyCollections();

  return promise;
};

Manager.prototype.removeSocketFromCollections = function(disconnected) {
  _.forEach(this.collections, function(channels, modelName) {
    _.forEach(channels, function(channel, key) {
      channel.listeners = _.filter(channel.listeners, function(l) { return l !== disconnected; });
    });
  });

  this._pruneEmptyCollections();

  //  Return an empty promise to comply with the external interface.
  return Q.fcall(function() {});
};

Manager.prototype.getRooms = function(modelName, paramList) {
  var filters = this.collections[modelName];
  var result = [];
  if (filters) {
    result = _(filters).reduce(function(acc, filter, key) {
      if (!paramList || doesMatchParams(paramList, filter)) {
        acc.push(key);
      }
      return acc;
    }, []);
  }

  return Q.fcall(function() { return result; });
};