/**
 * Module dependencies
 */
var MockReq = require('mock-req');
var SocketResponse = require('./mocks/SocketResponse');
var qs = require('qs');
var debug = require('debug')('transceiver:interpret');
var buildIO = require('./clientInterface');
var Q = require('q');
var _ = require('lodash');

/**
 * Interpret an incoming socket.io "request"
 * Emulates Express semantics by mocking request (`req`) and response (`res`)
 *
 * @param  {[type]}   socketReq        [incoming sails.io-formatted socket msg]
 * @param  {[type]}   socketIOCallback [an ack callback useful for sending a response back to the client]
 * @param  {[type]}   socket           [the socket that originated this request]
 * @param  {[type]}   messageName      [the name of the message]
 * @param  {[type]}   collectionManager[connection manager object]
 */
module.exports = function interpretSocketReq(
  app, socketReq, socketIOCallback, socket, messageName, collectionManager, roomPrefix
) {
  // If invalid callback function specified, freak out
  if (socketIOCallback && !_.isFunction(socketIOCallback)) {
    throw new Error("No callback specified for interpreting socket request.");
  }

  messageName = messageName.toUpperCase();
  res = new SocketResponse(app, socket, socketIOCallback);

  // Parse request as JSON (or just use the object if we have one)
  if (!_.isObject(socketReq) && _.isString(socketReq)) {
    try {
      socketReq = JSON.parse(socketReq);
    } catch (e) {
      res.json(400, "Could not parse JSON.");
      return;
    }
  }

  // If no URL specified, error out
  if (!socketReq.url) {
    res.json(400, "No URL specified in request.");
    return;
  }

  if (!_.isString(socketReq.url)) {
    res.json(400, "Invalid URL specified in request.");
    return;
  }

  // Attached data becomes simulated HTTP body (`req.body`)
  // Allow `params` or `data` to be specified for backwards/sideways-compatibility.
  var bodyParams = _.extend({}, socketReq.params || {}, socketReq.data || {});

  // Socket requests can't be relative.
  if (socketReq.url.indexOf("/") !== 0) socketReq.url = "/" + socketReq.url;

  var queryString = socketReq.url.split("?")[1];

  // Get forwarded ip:port from x-forwarded-for header if IIS
  var forwarded = socket.handshake.headers['x-forwarded-for'];
  forwarded = forwarded && forwarded.split(':') || [];

  var headers = _.defaults(socketReq.headers || {}, socket.handshake.headers);

  var addressObject = socket.handshake.address || {
    address: "0.0.0.0",
    port: "0",
  };

  // Build request object
  var req = {
    transport: 'socket.io',
    method: messageName,
    protocol: 'ws',
    ip: forwarded[0] || addressObject.address,
    port: forwarded[1] || addressObject.port,
    url: socketReq.url,
    socket: socket,
    isSocket: true,
    wantsJSON: true,
    connection: socket.connection,

    params: [],
    query: queryString ? qs.parse(queryString) : {},
    param: function(paramName) {

      var key, params = {};
      for (key in (req.params)) {
        params[key] = params[key] || req.params[key];
      }
      for (key in (req.query)) {
        params[key] = params[key] || req.query[key];
      }
      for (key in req.body) {
        params[key] = params[key] || req.body[key];
      }

      // Grab the value of the parameter from the appropriate place
      // and return it
      return params[paramName];
    },

    body: bodyParams,
    headers: headers
  };

  req.socket.destroy = function() {
    //  No-op;
  };

  // Now streamify the things
  req = new MockReq(req);

  //  Add the socket.io objects here.
  req.io = buildIO(collectionManager, roomPrefix, socket);
  res.io = req.io;

  // Pump client request body to the IncomingMessage stream (req)
  // Req stream ends automatically if this is a GET or HEAD or DELETE request
  // (since there is no request body in that case)
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
    req.write(req.body);
    req.end();
  }

  // Send newly constructed req and res objects back to router
  return {req: req, res: res};
};