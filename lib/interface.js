var Q = require('q');
var _ = require('lodash');
var debug = require('debug')('transceiver');

var formatData = function formatData(modelName, data) {
  return {
    "model": modelName,
    "id": data.id,
    "data": data
  };
};

module.exports = function(collectionManager, socket) {
  return {
    _room_prefix: 'model_',
    socket: socket,

    subscribe: function subscribe(modelName, params) {
      if (params) {
        return collectionManager.addListener(modelName, this.socket.id, params).then(function(room) {
          return Q.ninvoke(socket, 'join', this._room_prefix + modelName + ":" + room);
        }.bind(this));
      } else {
        return Q.ninvoke(socket, 'join', this._room_prefix + modelName);
      }
    },
    unsubscribe: function unsubscribe(modelName, params) {
      if (params) {
        return collectionManager.removeListener(modelName, this.socket.id, params).then(function(room) {
          return Q.ninvoke(socket, 'leave', this._room_prefix + modelName + ":" + room);
        }.bind(this));
      } else {
        return Q.ninvoke(socket, 'leave', this._room_prefix + modelName);
      }
    },
    subscribeAll: function subscribeAll(modelName, paramList) {
      return Q.all(_.map(paramList, this.subscribe.bind(this, modelName)));
    },
    unsubscribeAll: function unsubscribeAll(modelName, paramList) {
      return Q.all(_.map(paramList, this.unsubscribe.bind(this, modelName)));
    },
    clearRooms: function clearRooms() {
      socket.leaveAll();
    },

    _getRooms: function getRooms(modelName, data) {
      var prefix = this._room_prefix + modelName;
      return collectionManager.getRooms(modelName, data).then(function(rooms) {
        rooms = _.map(rooms, function(room) { return prefix + ":" + room; });
        rooms.push(prefix);
        return rooms;
      });
    },

    onObjectCreated: function onObjectCreated(modelName, data) {
      return this._getRooms(modelName, data).then(function(rooms) {
        _.forEach(rooms, function(room) {
          this.socket.server.to(room).emit("create", formatData(modelName, data));
        }, this);
      }.bind(this));
    },

    onObjectUpdated: function onObjectUpdated(modelName, oldData, newData) {
      return Q.all([
        this._getRooms(modelName, oldData),
        this._getRooms(modelName, newData)
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
          this.socket.server.to(room).emit("update", formatData(modelName, oldData));
        }, this);

        _.forEach(enteringRooms, function(room) {
          debug("enter", room);
          this.socket.server.to(room).emit("enter", formatData(modelName, newData));
        }, this);
      }.bind(this));
    },

    onObjectDeleted: function onObjectDeleted(modelName, data) {
      return this._getRooms(modelName, data).then(function(rooms) {
        _.forEach(rooms, function(room) {
          debug("destroy", room);
          this.socket.server.to(room).emit("destroy", formatData(modelName, data));
        }, this);
      }.bind(this));
    },
  };

};