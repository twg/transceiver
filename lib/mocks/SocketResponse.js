var _ = require('lodash');

module.exports = SocketResponse;

function SocketResponse(socketIOCallback) {
  this.writable = true;
  this.statusCode = null;
  this.charset = "utf-8";
  this.socketIOCallback = socketIOCallback;
}

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

require('util').inherits(SocketResponse, require('stream'));

// Extract args to `write` and emit as `data` event.
// Optional callback
SocketResponse.prototype.write = function(str) {
  // Fire 'data' event on socket
  this.socket.emit('data', str);
};

// If err set, emit `error`, otherwise emit `end` event.
// Optional callback
SocketResponse.prototype.end = function(err) {
  if (err) {
    this.emit('error', err);
    this.socket.emit('error', err);
  }
  else this.socket.emit('end');
};

SocketResponse.prototype.setHeader = function() {
    //  Noop.
};

SocketResponse.prototype.status = function setStatusCode(code) {
  this.statusCode = code;
  return this;
};

SocketResponse.prototype.send = function sendSimpleResponse( /* [statusCode|body],[statusCode|body] */ ) {
  var args = normalizeResArgs(arguments),
    statusCode = args.statusCode,
    body = args.other;

  // Don't allow users to respond/redirect more than once per request
  if (this._sent) {
    throw new Error("Response already sent!");
  }

  // Ensure statusCode is set
  // (override `this.statusCode` if `statusCode` argument specified)
  this.statusCode = statusCode || this.statusCode || 200;

  // Ensure charset is set
  this.charset = this.charset || 'utf-8';

  var responseCtx = {
    body: body,
    headers: this.headers,
    statusCode: this.statusCode,
  };

  // Send down response.
  this.socketIOCallback(responseCtx);
  this._sent = true;
  this.end();

  return this;
};

SocketResponse.prototype.end = function end(body, encoding) {
  if (body) {
    this.send(body);
  } else {
    this.emit('finish');
  }
};

SocketResponse.prototype.redirect = function doRedirect( /* [location|statusCode], [location|statusCode] */ ) {
  var args = normalizeResArgs(arguments),
    statusCode = args.statusCode,
    location = args.other;

  // Don't allow users to respond/redirect more than once per request
  if (this._sent) {
    throw new Error("Response already sent!");
  }

  // Ensure statusCode is set
  this.statusCode = statusCode || this.statusCode || 302;

  // Prevent redirects to public URLs
  var PUBLIC_URL = /^[^\/].+/;
  if (location.match(PUBLIC_URL)) {
    throw new Error('Cannot redirect socket to invalid location: ' + location);
  }

  // Set URL for redirect
  req.url = location;

  // Simulate another request at the new url
  app.handle(this.req, this);
};

SocketResponse.prototype.json = function sendJSON( /* [statusCode|obj],[statusCode|obj] */ ) {
  var args = normalizeResArgs(arguments),
    statusCode = args.statusCode,
    obj = args.other;

  var body = obj;
  return this.send(statusCode, body);
};

SocketResponse.prototype.jsonp = function sendJSONP( /* [statusCode|obj],[statusCode|obj] */ ) {
  return this.json.apply(this, arguments);
};

SocketResponse.prototype.header = function getHeader(headerName, value) {
  // Sets `headerName` to `value`
  if (value) {
    return this.set(headerName, value);
  }

  // `this.header(headerName)`
  // Returns value of `headerName`
  return this.get(headerName);
};

SocketResponse.prototype.set = function(headerName, value) {
  this.headers = this.headers || {};
  this.headers[headerName] = value;
  return value;
};

SocketResponse.prototype.get = function(headerName) {
  return this.headers && this.headers[headerName];
};

SocketResponse.prototype.locals = (function Locals() {
  this.partial = function renderPartial() {
    var errmsg = "View partials not supported over sockets.";
    log.warn(errmsg);
    this.json(500, {
      error: errmsg
    });
  };
}());

SocketResponse.prototype.local = function setLocal(localName, value) {
  // `this.local(localName)`
  // Sets `localName` to `value`
  if (value) {
    this.locals[localName] = value;
    return value;
  }

  // `this.local(localName)`
  // Returns value of `localName`
  return this.locals[localName];
};

//  Stub out each of these unimplemented methods.
var unimplemented = [
  'format', 'download', 'sendfile', 'attachment',
  'contentType', 'type', 'links', 'clearCookie',
  'signedCookie', 'cookie', 'render'
];
_.forEach(unimplemented, function(method) {
  SocketResponse.prototype[method] = function() {
    throw new Error(
      'The function this.' + method + ' is not yet supported over sockets.'
    );
  };
});