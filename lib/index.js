var _             = require('lodash');
var SocketServer  = require('socket.io');
var interpret     = require('./interpret');
var log           = require('bunyan').createLogger({name: 'sockets'});

function onSocketRequest(app, socket, messageName, socketRequest, ackCallback) {
  try {
    // Translate socket.io message to an Express-looking request
    var requestContext = interpret(app, socketRequest, ackCallback, socket, messageName);
    app.handle(requestContext.req, requestContext.res);
  } catch (e) {
    log.error({error: ""+e}, "Could not process socket event.");
    ackCallback({body: null, headers: {}, statusCode: 500});
  }
}

function mapRoute(app, socket, messageName) {
  socket.on(messageName, onSocketRequest.bind(null, app, socket, messageName));
}

module.exports = function(server, app, options) {
  var io = SocketServer(server);

  options = options || {};

  var onConnect = options.onConnect;
  var onDisconnect = options.onDisconnect;

  var methods = options.methods || ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

  io.sockets.on('connection', function onSocketConnect(socket) {
    //  Call mapRoute(app, socket, method) for each method.
    _.forEach(methods, mapRoute.bind(null, app, socket));

    if (onConnect) {
      onConnect(app, socket);
    }

    if (onDisconnect) {
      socket.on('disconnect', onDisconnect.bind(null, app, socket));
    }
  });
  
  return io;
};
