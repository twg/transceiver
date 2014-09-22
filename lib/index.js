var _             = require('lodash');
var SocketServer  = require('socket.io');
var interpret     = require('./interpret');
var debug         = require('debug')('transceiver');

//  TODO: Make this configurable.
var CollectionManager = require('./collectionManagers/memory');

var SocketResponse     = require('./mocks/SocketResponse');
var AddGlobalInterface = require('./globalInterface');
var BuildIO            = require('./clientInterface');

function onSocketRequest(app, socket, collectionManager, roomPrefix, messageName, socketRequest, ackCallback) {
  debug("Received request through socket:", messageName);
  try {
    // Translate socket.io message to an Express-looking request
    var requestContext = interpret(app, socketRequest, ackCallback, socket, messageName, collectionManager, roomPrefix);

    //  If requestContext is undefined or null, that means that something
    //  was wrong with the request - but that it was a client error, and that
    //  the interpret() function handled it.
    if (requestContext) {
      app.handle(requestContext.req, requestContext.res);
    }
  } catch (e) {
    debug({error: ""+e}, "Could not process socket event.");
    ackCallback({body: ""+e, headers: {}, statusCode: 500});
  }
}

function mapRoute(app, socket, collectionManager, roomPrefix, messageName) {
  var handler = onSocketRequest.bind(null, app, socket, collectionManager, roomPrefix, messageName);
  socket.on(messageName.toUpperCase(), handler);
  socket.on(messageName.toLowerCase(), handler);
}

module.exports = function(server, app, options) {
  var io = SocketServer(server);
  var manager = new CollectionManager();
  io.manager = manager;

  options = options || {};

  var onConnect = options.onConnect;
  var onDisconnect = options.onDisconnect;
  var roomPrefix = options.roomPrefix || "transceiver_";

  var methods = options.methods || ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

  io.sockets.on('connection', function onSocketConnect(socket) {
    debug("Received new socket connection " + socket.id + " binding methods", methods);

    //  Call mapRoute(app, socket, method) for each method.
    _.forEach(methods, mapRoute.bind(null, app, socket, manager, roomPrefix));

    if (onConnect) {
      onConnect(app, socket);
    }

    socket.on('disconnect', function() {
      if (onDisconnect) onDisconnect(app, socket);
      debug("Socket connection " + socket.id + " disconnected");
      manager.removeSocketFromCollections(socket.id);
    });
  });

  var globalIO = AddGlobalInterface(io, roomPrefix);

  app.use(function(req, res, next) {
    //  Reset our request/response prototypes, as
    //  express does this in express/lib/middleware/init.js:23
    if (res.io) {
      if (res.__proto__ !== SocketResponse.prototype) {
        res.__proto__ = SocketResponse.prototype;
      }
    } else {
      //  If we have a socketID parameter, add an io object here
      //  to allow subscription/unsubscription via regular HTTP requests.
      var socketId = req.get('X-Transceiver-Socket-ID');
      if (socketId) {
        var socket = io.sockets.connected[socketId];
        if (socket) {
          var localIO = BuildIO(manager, roomPrefix, socket);
          req.io = localIO;
          res.io = localIO;
        }
      }
    }

    req.globalIO = globalIO;
    res.globalIO = globalIO;
    next();
  });
  
  return globalIO;
};
