/**
 * Module dependencies
 */
var buildReq = require('./mocks/req');
var buildRes = require('./mocks/res');
var ResStream = require('./mocks/ResStream');

var buildIO = require('./interface');
var Q = require('q');
var _ = require('lodash');

/**
 * As long as one of them is a number (i.e. a status code),
 * allows a 2-nary method to be called with flip-flopped arguments:
 *    method( [statusCode|other], [statusCode|other] )
 *
 * This avoids confusing errors & provides Express 2.x backwards compat.
 *
 * E.g. usage in res.send():
 *    var args    = normalizeResArgs.apply(this, arguments),
 *      body    = args.other,
 *      statusCode  = args.statusCode;
 *
 * @api private
 */
function normalizeResArgs(args) {
  // Traditional usage:
  // `method( other [,statusCode] )`
  if ('number' !== typeof args[0] &&
    (!args[1] || 'number' === typeof args[1])) {
    return {
      statusCode: args[1],
      other: args[0]
    };
  } else {
    // Explicit usage, i.e. Express 3:
    // `method( statusCode [,other] )`
    return {
      statusCode: args[0],
      other: args[1]
    };
  }
}

/**
 * Get simulated HTTP method (aka "verb") for a given request object.
 * (NOTE: the returned verb will be in all caps, like "GET" or "POST")
 *
 * @param  {???} socketRequest
 * @param  {String} messageName
 * @return {String} the HTTP verb for this request, e.g. "HEAD" or "PATCH" or "DELETE"
 */
function getVerb(socketRequest, messageName) {
  if (_.isString(messageName)) {
    return messageName.toUpperCase();
  }

  // try and parse the socket io data if it looks like JSON
  var body;
  if (_.isString(socketIOData)) {
    try {
      body = JSON.parse(socketIOData);
    } catch (e) {}
  }

  // Only try to use the socket io data if it's usable
  if (_.isObject(body)) {
    if (_.isString(body.verb)) {
      return body.verb.toUpperCase();
    }

    if (_.isString(body.method)) {
      return body.method.toUpperCase();
    }
  }

  return 'GET';
}

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
module.exports = function interpretSocketReq(app, socketReq, socketIOCallback, socket, messageName, collectionManager) {
  var msg;

  // If invalid callback function specified, freak out
  if (socketIOCallback && !_.isFunction(socketIOCallback)) {
    throw new Error("No callback specified for interpreting socket request.");
  }

  // Parse request as JSON (or just use the object if we have one)
  if (!_.isObject(socketReq) && _.isString(socketReq)) {
    try {
      socketReq = JSON.parse(socketReq);
    } catch (e) {
      throw new Error("JSON from socket request could not be parsed: " + socketReq);
    }
  }

  // If no URL specified, error out
  if (!socketReq.url) {
    throw new Error('No url provided in request: ' + socketReq);
  }

  if (!_.isString(socketReq.url)) {
    throw new Error('Invalid url provided in request: ' + socketReq.url);
  }

  // Attached data becomes simulated HTTP body (`req.body`)
  // Allow `params` or `data` to be specified for backwards/sideways-compatibility.
  var bodyParams = _.extend({}, socketReq.params || {}, socketReq.data || {});

  // Get forwarded ip:port from x-forwarded-for header if IIS
  var forwarded = socket.handshake.headers['x-forwarded-for'];
  forwarded = forwarded && forwarded.split(':') || [];

  var headers = _.defaults(socketReq.headers || {}, socket.handshake.headers);

  // Build request object
  var req = {
    transport: 'socket.io',
    method: getVerb(socketReq, messageName),
    protocol: 'ws',
    ip: forwarded[0] || socket.handshake.address && socket.handshake.address.address,
    port: forwarded[1] || socket.handshake.address && socket.handshake.address.port,
    url: socketReq.url,
    socket: socket,
    isSocket: true,

    // Request params (`req.params`) are automatically parsed from URL path by the private router
    // query : queryParams || {},
    body: bodyParams || {},

    // Lookup parameter
    param: function(paramName) {
      var key, params = {};
      for (key in (req.params || {})) {
        params[key] = req.params[key];
      }
      for (key in (req.query || {})) {
        params[key] = req.query[key];
      }
      for (key in (req.body || {})) {
        params[key] = req.body[key];
      }

      // Grab the value of the parameter from the appropriate place
      // and return it
      return params[paramName];
    },

    headers: headers
  };

  req.header = function getHeader(headerName, defaultValue) {
    var headerValue = req.headers[headerName];
    return (typeof headerValue === 'undefined') ? defaultValue : headerValue;
  };

  // Build response object as stream
  var res = _.extend(new ResStream(), {
    statusCode: null,
    charset: 'utf-8'
  });

  res.status = function setStatusCode(code) {
    res.statusCode = code;
    return res;
  };

  res.send = function sendSimpleResponse( /* [statusCode|body],[statusCode|body] */ ) {
    var args = normalizeResArgs(arguments),
      statusCode = args.statusCode,
      body = args.other;

    // Don't allow users to respond/redirect more than once per request
    if (res._sent) {
      throw new Error("Response already sent!");
    }

    // Ensure statusCode is set
    // (override `this.statusCode` if `statusCode` argument specified)
    this.statusCode = statusCode || this.statusCode || 200;

    // Ensure charset is set
    this.charset = this.charset || 'utf-8';

    var responseCtx = {
      body: body,
      headers: res.headers,
      statusCode: res.statusCode,
    };

    // Send down response.
    socketIOCallback(responseCtx);
    res._sent = true;
    res.end();

    return res;
  };

  res.end = function end() {
    this.emit('finish');
  };

  res.redirect = function doRedirect( /* [location|statusCode], [location|statusCode] */ ) {
    var args = normalizeResArgs(arguments),
      statusCode = args.statusCode,
      location = args.other;

    // Don't allow users to respond/redirect more than once per request
    if (res._sent) {
      throw new Error("Response already sent!");
    }

    // Ensure statusCode is set
    res.statusCode = statusCode || res.statusCode || 302;

    // Prevent redirects to public URLs
    var PUBLIC_URL = /^[^\/].+/;
    if (location.match(PUBLIC_URL)) {
      throw new Error('Cannot redirect socket to invalid location: ' + location);
    }

    // Set URL for redirect
    req.url = location;

    // Simulate another request at the new url
    app.handle(req, res);
  };

  res.json = function sendJSON( /* [statusCode|obj],[statusCode|obj] */ ) {
    var args = normalizeResArgs(arguments),
      statusCode = args.statusCode,
      obj = args.other;

    var body = obj;
    return this.send(statusCode, body);
  };

  res.jsonp = function sendJSONP( /* [statusCode|obj],[statusCode|obj] */ ) {
    return this.json.apply(this, arguments);
  };

  res.header = function getHeader(headerName, value) {
    // Sets `headerName` to `value`
    if (value) {
      return res.set(headerName, value);
    }

    // `res.header(headerName)`
    // Returns value of `headerName`
    return res.get(headerName);
  };

  res.set = function(headerName, value) {
    res.headers = res.headers || {};
    res.headers[headerName] = value;
    return value;
  };

  res.get = function(headerName) {
    return res.headers && res.headers[headerName];
  };

  res.locals = (function Locals() {
    this.partial = function renderPartial() {
      var errmsg = "View partials not supported over sockets.";
      log.warn(errmsg);
      res.json(500, {
        error: errmsg
      });
    };
  }());

  res.local = function setLocal(localName, value) {
    // `res.local(localName)`
    // Sets `localName` to `value`
    if (value) {
      res.locals[localName] = value;
      return value;
    }

    // `res.local(localName)`
    // Returns value of `localName`
    return res.locals[localName];
  };

  //  Stub out each of these unimplemented methods.
  var unimplemented = [
    'format', 'download', 'sendfile', 'attachment',
    'contentType', 'type', 'links', 'clearCookie',
    'signedCookie', 'cookie', 'render'
  ];
  _.forEach(unimplemented, function(method) {
    res[method] = function() {
      throw new Error(
        'The function res.' + method + ' is not yet supported over sockets.'
      );
    };
  });

  // Now streamify the things
  req = buildReq(req, res);
  res = buildRes(req, res);

  //  Add the socket.io objects here.
  req.io = buildIO(collectionManager, socket);
  res.io = req.io;

  // Pump client request body to the IncomingMessage stream (req)
  // Req stream ends automatically if this is a GET or HEAD or DELETE request
  // (since there is no request body in that case)
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
    // Only write the body if there IS a body.
    if (req.body) {
      req.write(req.body);
    }
    req.end();
  }

  // Send newly constructed req and res objects back to router
  return {
    req: req,
    res: res
  };
};