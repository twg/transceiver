var Q = require('q');
var _ = require('lodash');
var debug = require('debug')('transceiver');
var formatData = require("./formatData");

module.exports = function(server, room_prefix) {
  server.getRooms = function getRooms(modelName, data) {
    debug('global interface fetching rooms for', modelName, data);
    var prefix = room_prefix + modelName;
    return server.manager.getRooms(modelName, data).then(function(rooms) {
      rooms = _.map(rooms, function(room) { return prefix + ":" + room; });
      rooms.push(prefix);
      debug('rooms for', modelName, data, "=", rooms);
      return rooms;
    });
  };

  server.onObjectCreated = function onObjectCreated(modelName, data) {
    return server.getRooms(modelName, data).then(function(rooms) {
      _.forEach(rooms, function(room) {
        server.to(room).emit("create", formatData(modelName, data));
      });
    });
  };

  server.onObjectUpdated = function onObjectUpdated(modelName, oldData, newData) {
    return Q.all([
      server.getRooms(modelName, oldData),
      server.getRooms(modelName, newData)
    ]).spread(function(oldRooms, newRooms) {
      var leavingRooms = _.difference(oldRooms, newRooms);
      var enteringRooms = _.difference(newRooms, oldRooms);
      var updatedRooms = _.intersection(oldRooms, newRooms);

      _.forEach(leavingRooms, function(room) {
        debug("exit", room);
        server.to(room).emit("exit", formatData(modelName, oldData));
      });

      _.forEach(updatedRooms, function(room) {
        debug("update", room);
        server.to(room).emit("update", formatData(modelName, newData));
      });

      _.forEach(enteringRooms, function(room) {
        debug("enter", room);
        server.to(room).emit("enter", formatData(modelName, newData));
      });
    });
  };

  server.onObjectDeleted = function onObjectDeleted(modelName, data) {
    return server.getRooms(modelName, data).then(function(rooms) {
      _.forEach(rooms, function(room) {
        debug("destroy", room);
        server.to(room).emit("destroy", formatData(modelName, data));
      });
    });
  };

  return server;
};