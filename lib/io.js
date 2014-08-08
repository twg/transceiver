var Q = require('q');
var _ = require('lodash');

var formatData = function formatData(modelName, data) {
  return {
    "model": modelName,
    "id": data.id,
    "data": data
  };
};

module.exports = function(socket) {
  var o = {
    _room_prefix: 'model_',

    _createParamString: function(params) {
      return _.sortBy(_.map(params, function(value, key) {
        return key + ":" + value;
      })).join(":");
    },

    addFilterParams: function(modelName, params) {
      var paramString = this._createParamString(params);
      var server = o.socket.server;
      server.filterParams = server.filterParams || {};

      //  Check to see if anybody has already listened for this model with params.
      var existingParams = server.filterParams[modelName];
      if (!existingParams) server.filterParams[modelName] = {};

      //  Check to see if anybody is already listening on this exact set of params.
      var existingSockets = server.filterParams[modelName][paramString];
      if (!existingSockets) server.filterParams[modelName][paramString] = [];

      server.filterParams[modelName][paramString].push(socket.id);
    },
    getFilterParams: function(modelName) {
      return Object.values((o.socket.server.filterParams || {})[modelName]);
    },

    subscribe: function subscribe(modelName, params) {
      var paramString = this._createParamString(params);
      var room = o._room_prefix + modelName;
      if (params) room += ":" + paramString;
      console.log(socket.id, "joining", room);
      return Q.ninvoke(socket, 'join', room);
    },
    unsubscribe: function unsubscribe(modelName, params) {
      var paramString = this._createParamString(params);
      var room = o._room_prefix + modelName;
      if (params) room += ":" + paramString;
      console.log(socket.id, "leaving", room);
      return Q.ninvoke(socket, 'leave', room);
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

    publishCreate: function publishCreate(modelName, data) {
      var room = o._room_prefix + modelName;

      //  Add all sockets that are listening to the create
      //  room to the "instance" room as well.
      var instanceRoom = o._room_prefix + modelName + ":" + data.id;
      var socketIDs = Object.keys(socket.server.sockets.adapter.rooms[room] || {});
      return Q.all(_.map(socketIDs, function(socketID) {
        var socket = o.socket.server.sockets.connected[socketID];
        return Q.ninvoke(socket, 'join', instanceRoom);
      })).then(function() {
        //  Emit the new data to the create room.
        socket.server.to(room).emit("create", formatData(modelName, data));
      });
    },
    publishUpdate: function publishUpdate(modelName, data) {
      var room = o._room_prefix + modelName + ":" + data.id;
      socket.server.to(room).emit("update", formatData(modelName, data));
    },
    publishDestroy: function publishDestroy(modelName, data) {
      var room = o._room_prefix + modelName + ":" + data.id;
      socket.server.to(room).emit("destroy", formatData(modelName, data));

      var socketIDs = Object.keys(socket.server.sockets.adapter.rooms[room] || {});
      return Q.all(_.map(socketIDs, function(socketID) {
        var socket = o.socket.server.sockets.connected[socketID];
        return Q.ninvoke(socket, 'leave', room);
      }));
    },

    socket: socket,
  };
  return o;
};