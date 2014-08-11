var _             = require('lodash');
var SocketServer  = require('socket.io');
var interpret     = require('./interpret');
var log           = require('bunyan').createLogger({name: 'sockets'});

//  TODO: Make this configurable.
var CollectionManager = require('./collectionManagers/memory');

function onSocketRequest(app, socket, collectionManager, messageName, socketRequest, ackCallback) {
  try {
    // Translate socket.io message to an Express-looking request
    var requestContext = interpret(app, socketRequest, ackCallback, socket, messageName, collectionManager);
    app.handle(requestContext.req, requestContext.res);
  } catch (e) {
    log.error({error: ""+e}, "Could not process socket event.");
    ackCallback({body: null, headers: {}, statusCode: 500});
  }
}

function mapRoute(app, socket, collectionManager, messageName) {
  socket.on(messageName, onSocketRequest.bind(null, app, socket, collectionManager, messageName));
}

module.exports = function(server, app, options) {
  var io = SocketServer(server);
  var manager = new CollectionManager();

  options = options || {};

  var onConnect = options.onConnect;
  var onDisconnect = options.onDisconnect;

  var methods = options.methods || ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

  io.sockets.on('connection', function onSocketConnect(socket) {
    //  Call mapRoute(app, socket, method) for each method.
    _.forEach(methods, mapRoute.bind(null, app, socket, manager));

    if (onConnect) {
      onConnect(app, socket);
    }

    socket.on('disconnect', function() {
      if (onDisconnect) onDisconnect(app, socket);
      //manager.onDisconnect(socket.id);
    });
  });
  
  return io;
};
