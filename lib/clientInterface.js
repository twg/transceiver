var Q = require('q');
var _ = require('lodash');
var debug = require('debug')('transceiver');
var formatData = require("./formatData");

module.exports = function(collectionManager, room_prefix, socket) {
  return {
    socket: socket,

    subscribe: function subscribe(modelName, params) {
      if (params) {
        return collectionManager.addListener(modelName, this.socket.id, params).then(function(room) {
          var roomName = room_prefix + modelName + ":" + room;

          //  If Socket.io already has us in this room, our callback will never be called.
          if (socket.rooms.indexOf(roomName) !== -1) {
            return Q.fcall(function() { return null; });
          }

          debug('socket', socket.id, 'joining room', roomName);
          return Q.ninvoke(socket, 'join', roomName);
        }.bind(this));
      } else {
        var roomName = room_prefix + modelName;
        if (socket.rooms.indexOf(roomName) !== -1) {
          return Q.fcall(function() { return null; });
        }
        debug('socket', socket.id, 'joining room', roomName);
        return Q.ninvoke(socket, 'join', roomName);
      }
    },
    unsubscribe: function unsubscribe(modelName, params) {
      if (params) {
        return collectionManager.removeListener(modelName, this.socket.id, params).then(function(room) {
          var roomName = room_prefix + modelName + ":" + room;
          debug('socket', socket.id, 'leaving room', roomName);
          return Q.ninvoke(socket, 'leave', roomName);
        }.bind(this));
      } else {
        var roomName = room_prefix + modelName;
        debug('socket', socket.id, 'leaving room', roomName);
        return Q.ninvoke(socket, 'leave', roomName);
      }
    },
    subscribeAll: function subscribeAll(modelName, paramList) {
      return Q.all(_.map(paramList, this.subscribe.bind(this, modelName)));
    },
    unsubscribeAll: function unsubscribeAll(modelName, paramList) {
      return Q.all(_.map(paramList, this.unsubscribe.bind(this, modelName)));
    },
    clearRooms: function clearRooms() {
      return collectionManager.removeSocketFromCollections(socket.id).then(function() {
        socket.leaveAll();
      });
    },

    getRooms: function getRooms(modelName, data) {
      var prefix = room_prefix + modelName;
      return collectionManager.getRooms(modelName, data).then(function(rooms) {
        rooms = _.map(rooms, function(room) { return prefix + ":" + room; });
        rooms.push(prefix);
        return rooms;
      });
    },

    onObjectCreated: function onObjectCreated(modelName, data) {
      return this.getRooms(modelName, data).then(function(rooms) {
        _.forEach(rooms, function(room) {
          this.socket.server.to(room).emit("create", formatData(modelName, data));
        }, this);
      }.bind(this));
    },

    onObjectUpdated: function onObjectUpdated(modelName, oldData, newData) {
      return Q.all([
        this.getRooms(modelName, oldData),
        this.getRooms(modelName, newData)
      ]).spread(function(oldRooms, newRooms) {
        var leavingRooms = _.difference(oldRooms, newRooms);
        var enteringRooms = _.difference(newRooms, oldRooms);
        var updatedRooms = _.intersection(oldRooms, newRooms);

        _.forEach(leavingRooms, function(room) {
          debug("exit", room);
          this.socket.server.to(room).emit("exit", formatData(modelName, oldData));
        }, this);

        _.forEach(updatedRooms, function(room) {
          debug("update", room);
          this.socket.server.to(room).emit("update", formatData(modelName, newData));
        }, this);

        _.forEach(enteringRooms, function(room) {
          debug("enter", room);
          this.socket.server.to(room).emit("enter", formatData(modelName, newData));
        }, this);
      }.bind(this));
    },

    onObjectDeleted: function onObjectDeleted(modelName, data) {
      return this.getRooms(modelName, data).then(function(rooms) {
        _.forEach(rooms, function(room) {
          debug("destroy", room);
          this.socket.server.to(room).emit("destroy", formatData(modelName, data));
        }, this);
      }.bind(this));
    },
  };

};