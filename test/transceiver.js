//  Much of this test infrastructure ripped directly from
//  Socket.io's tests: https://github.com/Automattic/socket.io/blob/master/test/socket.io.js

var http = require('http').Server;
var express = require('express');
var io = require('..');
var fs = require('fs');
var join = require('path').join;
var ioc = require('socket.io-client');
var request = require('supertest');
var expect = require('expect.js');
var transceiver = require('..');
var _ = require('lodash');

// creates a socket.io client for the given server
function client(srv, nsp, opts){
  if ('object' == typeof nsp) {
    opts = nsp;
    nsp = null;
  }
  var addr = srv.address();
  if (!addr) addr = srv.listen().address();
  var url = 'ws://' + addr.address + ':' + addr.port + (nsp || '');
  return ioc(url, opts);
}

function createServer(options, cb) {
  if (!cb && typeof options === 'function') {
    cb = options;
    options = null;
  }

  var app = express();
  var server = require('http').Server(app);
  var io = transceiver(server, app, options);

  server.listen(function() {
    cb(app, server, io);
  });
}

describe('transceiver', function() {

  describe('socket.io', function() {
    
    it('should connect to an Express server as middleware', function(done) {
      createServer(function(app, server) {
        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          server.close(done);
        });
      });
    });

    it('should disconnect gracefully without crashing', function(done) {
      createServer(function(app, server) {
        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.disconnect();
          setTimeout(function() {
            server.close(done);
          }, 10);
        });
      });
    });

    it('should call the prescribed onConnect function on connection', function(done) {
      var onConnectCalled = false;
      var onConnect = function(app, socket) {
        if (app && socket) onConnectCalled = true;
      };

      createServer({onConnect: onConnect}, function(app, server) {
        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          if (onConnectCalled) {
            server.close(done);
          } else {
            server.close(function() {
              done(new Error("onConnect callback not called correctly."));
            });
          }
        });
      });
    });

    it('should call the prescribed onDisconnect function on disconnection', function(done) {
      var onDisconnectCalled = false;
      var onDisconnect = function(app, socket) {
        if (app && socket) onDisconnectCalled = true;
      };

      createServer({onDisconnect: onDisconnect}, function(app, server) {
        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.disconnect();
          setTimeout(function() {
            if (onDisconnectCalled) {
              server.close(done);
            } else {
              server.close(function() {
                done(new Error("onDisconnect callback not called correctly."));
              });
            }
          }, 10);
        });
      });
    });

  });

  describe('http tunneling', function() {
    it('should fail to interpret a request with no arguments', function(done) {
      var interpreter = require('../lib/interpret');
      try {
        interpreter();
        done(new Error("Expected error, got none."));
      } catch (e) {
        done();
      }
    });

    it('should fail to interpret a request with bad callback arguments', function(done) {
      var interpreter = require('../lib/interpret');
      try {
        interpreter(null, null, {}, null, null);
        done(new Error("Expected error, got none."));
      } catch (e) {
        if (e.toString().indexOf("callback") !== -1) {
          done();
        } else {
          done(new Error("Expected the word 'callback' in error."));
        }
      }
    });

    it('should send an HTTP GET through the socket and get a default Express 404', function(done) {
      createServer(function(app, server) {
        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "/",
            data: undefined,
          };

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(404);
            expect(response.body).to.be.a('string');
            done();
          });

        });
      });
    });

    it('should call the param method to fetch params', function(done) {
      createServer(function(app, server) {

        app.get('/', function(req, res, next) {
          expect(req.param('test')).to.be(undefined);
          res.json({"message": "hello world!"});
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "/",
            data: undefined,
          };

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            done();
          });

        });
      });
    });

    it('should call the param method to fetch query params', function(done) {
      createServer(function(app, server) {

        app.get('/', function(req, res, next) {
          expect(req.param('test')).to.be('1');
          res.json({"message": "hello world!"});
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "/?test=1",
            data: undefined,
          };

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            done();
          });

        });
      });
    });

    it('should resolve parameters in the same order as Express', function(done) {
      createServer(function(app, server) {

        app.get('/:test1', function(req, res, next) {
          expect(req.param('test1')).to.be('1');
          expect(req.param('test2')).to.be('2');
          expect(req.param('test3')).to.be('3');
          res.json({"message": "hello world!"});
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "/1/?test1=2&test2=2",
            data: {test1: '3', test2: '3', test3: '3'},
          };

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            done();
          });

        });
      });
    });

    it('should allow requests without a leading slash', function(done) {
      createServer(function(app, server) {

        app.get('/:test1', function(req, res, next) {
          expect(req.param('test1')).to.be('1');
          expect(req.param('test2')).to.be('2');
          expect(req.param('test3')).to.be('3');
          res.json({"message": "hello world!"});
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "1/?test1=2&test2=2",
            data: {test1: '3', test2: '3', test3: '3'},
          };

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            done();
          });

        });
      });
    });

    it('should send an HTTP GET and get a 200', function(done) {
      createServer(function(app, server) {
        app.get('/', function(req, res, next) {
          res.json({"message": "hello world!"});
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "/",
            data: undefined,
          };

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body.message).to.be('hello world!');
            done();
          });

        });
      });
    });

    it('should send an HTTP POST and get a 200', function(done) {
      createServer(function(app, server) {
        app.post('/', function(req, res, next) {
          res.json({"message": "hello world!"});
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "/",
            data: undefined,
          };

          clientSocket.emit('POST', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body.message).to.be('hello world!');
            done();
          });

        });
      });
    });

    it('should send an HTTP POST with query params', function(done) {
      createServer(function(app, server) {
        var backendData = {};

        app.post('/path/:id', function(req, res, next) {
          var id = parseInt(req.param('id'), 10);
          backendData[id] = req.body;
          res.json({id: id, data: req.body});
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var id = 5;

          var data = {
            url: "/path/" + id,
            data: {"message": "hello world"},
          };

          clientSocket.emit('POST', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body.id).to.be(id);
            expect(response.body.data.message).to.be('hello world');
            expect(backendData[id]).to.eql(data.data);
            done();
          });

        });
      });
    });

    it('should error on improperly formatted json', function(done) {
      createServer(function(app, server) {
        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.emit('POST', "", function(response) {
            expect(response.statusCode).to.be(400);
            done();
          });
        });
      });
    });

    it('should error on missing URL in JSON', function(done) {
      createServer(function(app, server) {
        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.emit('POST', "{}", function(response) {
            expect(response.statusCode).to.be(400);
            done();
          });
        });
      });
    });

    it('should error on improper URL in JSON', function(done) {
      createServer(function(app, server) {
        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.emit('POST', "{\"url\": {}}", function(response) {
            expect(response.statusCode).to.be(400);
            done();
          });
        });
      });
    });

    it('should disallow multiple send calls', function(done) {
      createServer(function(app, server) {

        app.post('/', function(req, res, next) {
          res.send("a");
          try {
            res.send("b");
          } catch (e) {
            done();
          }
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.emit('POST', JSON.stringify({url: "/"}), function(response) {
          });
        });
      });
    });

    it('should not do anything on writes to the socket', function(done) {
      createServer(function(app, server) {

        app.post('/', function(req, res, next) {
          res.write("a");
          res.write("b");
          res.send("");
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.emit('POST', JSON.stringify({url: "/"}), function(response) {
            if (response.body === "") {
              done();
            } else {
              done(new Error("Expected response body to be ab, got " + response.body));
            }
          });
        });
      });
    });

    it('should end the request', function(done) {
      createServer(function(app, server) {

        app.post('/', function(req, res, next) {
          res.end();
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.emit('POST', JSON.stringify({url: "/"}), function(response) {
            if (response.body === "" && response.statusCode === 200) {
              done();
            } else {
              done(new Error("Expected empty body and 200 status code."));
            }
          });
        });
      });
    });

    it('should set the status code', function(done) {
      createServer(function(app, server) {

        app.post('/', function(req, res, next) {
          res.status(123);
          res.end();
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.emit('POST', JSON.stringify({url: "/"}), function(response) {
            if (response.body === "" && response.statusCode === 123) {
              done();
            } else {
              done(new Error("Expected empty body and 123 status code."));
            }
          });
        });
      });
    });

    it('should allow for redirects', function(done) {
      createServer(function(app, server) {

        app.post('/', function(req, res, next) {
          res.redirect("/other");
        });
        app.post('/other', function(req, res, next) {
          res.status(200);
          res.end("other");
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.emit('POST', JSON.stringify({url: "/"}), function(response) {
            if (response.body === "other" && response.statusCode === 200) {
              done();
            } else {
              done(new Error("Expected 'other' body."));
            }
          });
        });
      });
    });

    it('should disallow redirects if already sent', function(done) {
      createServer(function(app, server) {

        app.post('/', function(req, res, next) {
          res.end("done done");
          try {
            res.redirect("/other");
          } catch (e) {
            return done();
          }
          done(new Error("Expected an exception, got nothing."));
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.emit('POST', JSON.stringify({url: "/"}), function(response) {
          });
        });
      });
    });

    it('should disallow redirects to unhandlable domains', function(done) {
      createServer(function(app, server) {

        app.post('/', function(req, res, next) {
          try {
            res.redirect("http://google.com");
          } catch (e) {
            return done();
          }
          done(new Error("Expected an exception, got nothing."));
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          clientSocket.emit('POST', JSON.stringify({url: "/"}), function(response) {
          });
        });
      });
    });

    it('should allow use of the jsonp function (ugh)', function(done) {
      createServer(function(app, server) {
        app.get('/', function(req, res, next) {
          res.jsonp({"message": "hello world!"});
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "/",
            data: undefined,
          };

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body.message).to.be('hello world!');
            done();
          });

        });
      });
    });

    it('should set headers', function(done) {
      createServer(function(app, server) {
        app.get('/', function(req, res, next) {
          res.header("myHeader", "myValue");
          res.json({"message": "hello world!"});
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "/",
            data: undefined,
          };

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body.message).to.be('hello world!');
            expect(response.headers.myHeader).to.eql("myValue");
            done();
          });

        });
      });
    });

    it('should get headers', function(done) {
      createServer(function(app, server) {
        app.get('/', function(req, res, next) {
          res.header("myHeader", "myValue");
          if (res.header('myHeader') === "myValue") {
            done();
          } else {
            done(new Error("Expected header value to match."));
          }
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "/",
            data: undefined,
          };

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
          });
        });
      });
    });

    it('should throw an exception for unimplemented methods', function(done) {
      createServer(function(app, server) {
        app.get('/', function(req, res, next) {
          try {
            res.download();
            done(new Error("Expected exception, got nothing."));
          } catch (e) {
            return done();
          }
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {

          var data = {
            url: "/",
            data: undefined,
          };

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
          });
        });
      });
    });

  });

  describe('subscription manager', function() {
    it('should subscribe to a model without params', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";

        app.get('/resource', function(req, res, next) {
          res.io.subscribe(modelName).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.be.empty();
              done();
            });
          });

        });
      });
    });

    it('should unsubscribe from a model without params', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";

        var expressIO = null;
        app.get('/resource', function(req, res, next) {
          expressIO = res.io;

          res.io.subscribe(modelName).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.be.empty();
              expressIO.unsubscribe(modelName).then(function() {
                transceiver.manager.getRooms(modelName).then(function(rooms) {
                  expect(rooms).to.be.empty();
                  done();
                });
              });
            });
          });

        });
      });
    });

    it('should subscribe to a model with params', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";

        app.get('/resource', function(req, res, next) {
          res.io.subscribe(modelName, {id: 1}).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.eql(["id:1"]);
              done();
            });
          });

        });
      });
    });

    it('should unsubscribe from a model with params', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";

        var expressIO = null;
        app.get('/resource', function(req, res, next) {
          expressIO = res.io;

          res.io.subscribe(modelName, {id: 1}).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.eql(["id:1"]);
              expressIO.unsubscribe(modelName, {id: 1}).then(function() {
                transceiver.manager.getRooms(modelName).then(function(rooms) {
                  expect(rooms).to.be.empty();
                  done();
                });
              });
            });
          });

        });
      });
    });

    it('should subscribe to multiple param lists', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];

        var expressIO = null;
        app.get('/resource', function(req, res, next) {
          expressIO = res.io;

          res.io.subscribeAll(modelName, models).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.have.length(models.length);
              done();
            });
          });

        });
      });
    });

    it('should unsubscribe from multiple param lists', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];

        var expressIO = null;
        app.get('/resource', function(req, res, next) {
          expressIO = res.io;

          res.io.subscribeAll(modelName, models).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.have.length(models.length);
              expressIO.unsubscribeAll(modelName, models).then(function() {
                transceiver.manager.getRooms(modelName).then(function(rooms) {
                  expect(rooms).to.be.empty();
                  done();
                });
              });
            });
          });

        });
      });
    });

    it('should allow subscribing multiple times to a model without params', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";

        app.get('/resource', function(req, res, next) {
          res.io.subscribe(modelName).then(function() {
            return res.io.subscribe(modelName);
          }).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.be.empty();
              done();
            });
          });

        });
      });
    });

    it('should allow subscribing multiple times to a model with params', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";

        app.get('/resource', function(req, res, next) {
          res.io.subscribe(modelName, {id: 1}).then(function() {
            return res.io.subscribe(modelName, {id: 1});
          }).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.eql(["id:1"]);
              done();
            });
          });

        });
      });
    });

    it('should allow unsubscribing multiple times from a model', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var expressIO = null;

        app.get('/resource', function(req, res, next) {
          expressIO = res.io;
          res.io.subscribe(modelName, {id: 1}).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.eql(["id:1"]);
              expressIO.unsubscribe(modelName, {id: 1}).then(function() {
                return expressIO.unsubscribe(modelName, {id: 1});
              }).then(function() {
                transceiver.manager.getRooms(modelName).then(function(rooms) {
                  expect(rooms).to.be.empty();
                  done();
                });
              });
            });
          });

        });
      });
    });

    it('should allow unsubscribing multiple times from a model while multiple subscriptions exist', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var expressIO = null;

        app.get('/resource', function(req, res, next) {
          expressIO = res.io;
          res.io.subscribe(modelName, {id: 1}).then(function() {
            res.io.subscribe(modelName, {id: 2}).then(function() {
              res.json([]);
            });
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.eql(["id:1", "id:2"]);
              expressIO.unsubscribe(modelName, {id: 2}).then(function() {
                return expressIO.unsubscribe(modelName, {id: 2});
              }).then(function() {
                transceiver.manager.getRooms(modelName).then(function(rooms) {
                  expect(rooms).to.eql(["id:1"]);
                  done();
                });
              });
            });
          });

        });
      });
    });

    it('should unsubscribe automatically on disconnection', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";

        var expressIO = null;
        app.get('/resource', function(req, res, next) {
          expressIO = res.io;

          res.io.subscribe(modelName, {id: 1}).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.eql(["id:1"]);
              clientSocket.disconnect();
              setTimeout(function() {
                transceiver.manager.getRooms(modelName).then(function(rooms) {
                  expect(rooms).to.be.empty();
                  done();
                });
              }, 10);
            });
          });

        });
      });
    });

    it('should unsubscribe from all on clearRooms()', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";

        var expressIO = null;
        app.get('/resource', function(req, res, next) {
          expressIO = res.io;

          res.io.subscribe(modelName, {id: 1}).then(function() {
            res.json([]);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            transceiver.manager.getRooms(modelName).then(function(rooms) {
              expect(rooms).to.eql(["id:1"]);
              expressIO.clearRooms().then(function() {
                setTimeout(function() {
                  transceiver.manager.getRooms(modelName).then(function(rooms) {
                    try {
                      expect(rooms).to.be.empty();
                      done();
                    } catch (e) {
                      done(e);
                    }
                  });
                }, 10);
              });
            });
          });

        });
      });
    });

  });

  describe('collection observation', function() {

    it('should receive `create` messages for new models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var newModel = {id: 5, color: 'orange', data: 5};

        var expressIO = null;

        app.get('/resource', function(req, res, next) {
          expressIO = res.io;
          res.io.subscribe(modelName).then(function() {
            res.json(models);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models);

            clientSocket.on('create', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(newModel);
              done();
            });

            expressIO.onObjectCreated(modelName, newModel);
          });
        });
      });
    });

    it('should receive `destroy` messages for deleted models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];

        var expressIO = null;

        app.get('/resource', function(req, res, next) {
          expressIO = res.io;
          res.io.subscribe(modelName).then(function() {
            res.json(models);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models);

            clientSocket.on('destroy', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(models[0]);
              done();
            });

            expressIO.onObjectDeleted(modelName, models[0]);
          });
        });
      });
    });

    it('should receive `update` messages for updated models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var updatedModel = {id: 4, color: 'orange', data: 4};

        var expressIO = null;

        app.get('/resource', function(req, res, next) {
          expressIO = res.io;
          res.io.subscribe(modelName).then(function() {
            res.json(models);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models);

            clientSocket.on('update', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(updatedModel);
              done();
            });

            expressIO.onObjectUpdated(modelName, models[3], updatedModel);
          });
        });
      });
    });

  });

  describe('filtered collection observation', function() {

    it('should receive `create` messages for new models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var newModel = {id: 5, color: 'green', data: 5};

        var expressIO = null;

        app.get('/resource/:color', function(req, res, next) {
          expressIO = res.io;
          res.io.subscribe(modelName, {color: req.param('color')}).then(function() {
            res.json(_.filter(models, function(m) { return m.color === req.param('color'); }));
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource/green"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models.slice(2, 4));

            clientSocket.on('create', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(newModel);
              done();
            });

            expressIO.onObjectCreated(modelName, newModel);
          });
        });
      });
    });

    it('should receive `enter` messages for updated models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var updatedModel = {id: 4, color: 'blue', data: 4};

        var expressIO = null;

        app.get('/resource/:color', function(req, res, next) {
          expressIO = res.io;
          res.io.subscribe(modelName, {color: req.param('color')}).then(function() {
            res.json(_.filter(models, function(m) { return m.color === req.param('color'); }));
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource/blue"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models.slice(0, 2));

            clientSocket.on('enter', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(updatedModel);
              done();
            });

            expressIO.onObjectUpdated(modelName, models[3], updatedModel);
          });
        });
      });
    });

    it('should receive `update` messages for updated models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var updatedModel = {id: 4, color: 'orange', data: 4};

        var expressIO = null;

        app.get('/resource', function(req, res, next) {
          expressIO = res.io;
          res.io.subscribe(modelName).then(function() {
            res.json(models);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models);

            clientSocket.on('update', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(updatedModel);
              done();
            });

            expressIO.onObjectUpdated(modelName, models[3], updatedModel);
          });
        });
      });
    });

    it('should receive `exit` messages for updated models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var updatedModel = {id: 4, color: 'blue', data: 4};

        var expressIO = null;

        app.get('/resource/:color', function(req, res, next) {
          expressIO = res.io;
          res.io.subscribe(modelName, {color: req.param('color')}).then(function() {
            res.json(_.filter(models, function(m) { return m.color === req.param('color'); }));
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource/green"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models.slice(2, 4));

            clientSocket.on('exit', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(models[3]);
              done();
            });

            expressIO.onObjectUpdated(modelName, models[3], updatedModel);
          });
        });
      });
    });

    it('should receive `destroy` messages for deleted models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];

        var expressIO = null;

        app.get('/resource', function(req, res, next) {
          expressIO = res.io;
          res.io.subscribe(modelName).then(function() {
            res.json(models);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models);

            clientSocket.on('destroy', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(models[0]);
              done();
            });

            expressIO.onObjectDeleted(modelName, models[0]);
          });
        });
      });
    });
  });
  describe('global collection observation', function() {

    it('should receive `create` messages for new models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var newModel = {id: 5, color: 'orange', data: 5};

        app.get('/resource', function(req, res, next) {
          res.io.subscribe(modelName).then(function() {
            res.json(models);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models);

            clientSocket.on('create', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(newModel);
              done();
            });

            transceiver.onObjectCreated(modelName, newModel);
          });
        });
      });
    });

    it('should receive `destroy` messages for deleted models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];

        app.get('/resource', function(req, res, next) {
          res.io.subscribe(modelName).then(function() {
            res.json(models);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models);

            clientSocket.on('destroy', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(models[0]);
              done();
            });

            transceiver.onObjectDeleted(modelName, models[0]);
          });
        });
      });
    });

    it('should receive `update` messages for updated models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var updatedModel = {id: 4, color: 'orange', data: 4};

        app.get('/resource', function(req, res, next) {
          res.io.subscribe(modelName).then(function() {
            res.json(models);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models);

            clientSocket.on('update', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(updatedModel);
              done();
            });

            transceiver.onObjectUpdated(modelName, models[3], updatedModel);
          });
        });
      });
    });

  });

  describe('global filtered collection observation', function() {

    it('should receive `create` messages for new models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var newModel = {id: 5, color: 'green', data: 5};

        app.get('/resource/:color', function(req, res, next) {
          res.io.subscribe(modelName, {color: req.param('color')}).then(function() {
            res.json(_.filter(models, function(m) { return m.color === req.param('color'); }));
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource/green"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models.slice(2, 4));

            clientSocket.on('create', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(newModel);
              done();
            });

            transceiver.onObjectCreated(modelName, newModel);
          });
        });
      });
    });

    it('should receive `enter` messages for updated models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var updatedModel = {id: 4, color: 'blue', data: 4};

        app.get('/resource/:color', function(req, res, next) {
          res.io.subscribe(modelName, {color: req.param('color')}).then(function() {
            res.json(_.filter(models, function(m) { return m.color === req.param('color'); }));
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource/blue"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models.slice(0, 2));

            clientSocket.on('enter', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(updatedModel);
              done();
            });

            transceiver.onObjectUpdated(modelName, models[3], updatedModel);
          });
        });
      });
    });

    it('should receive `update` messages for updated models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var updatedModel = {id: 4, color: 'orange', data: 4};

        app.get('/resource', function(req, res, next) {
          res.io.subscribe(modelName).then(function() {
            res.json(models);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models);

            clientSocket.on('update', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(updatedModel);
              done();
            });

            transceiver.onObjectUpdated(modelName, models[3], updatedModel);
          });
        });
      });
    });

    it('should receive `exit` messages for updated models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];
        var updatedModel = {id: 4, color: 'blue', data: 4};

        app.get('/resource/:color', function(req, res, next) {
          res.io.subscribe(modelName, {color: req.param('color')}).then(function() {
            res.json(_.filter(models, function(m) { return m.color === req.param('color'); }));
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource/green"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models.slice(2, 4));

            clientSocket.on('exit', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(models[3]);
              done();
            });

            transceiver.onObjectUpdated(modelName, models[3], updatedModel);
          });
        });
      });
    });

    it('should receive `destroy` messages for deleted models', function(done) {
      createServer(function(app, server, transceiver) {
        var modelName = "model";
        var models = [
          {id: 1, color: 'blue', data: 1},
          {id: 2, color: 'blue', data: 2},
          {id: 3, color: 'green', data: 3},
          {id: 4, color: 'green', data: 4},
        ];

        app.get('/resource', function(req, res, next) {
          res.io.subscribe(modelName).then(function() {
            res.json(models);
          });
        });

        var clientSocket = client(server, { reconnection: false });
        clientSocket.on('connect', function onConnect() {
          var data = {url: "/resource"};

          clientSocket.emit('GET', JSON.stringify(data), function(response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.eql(models);

            clientSocket.on('destroy', function(notification) {
              expect(notification.model).to.eql(modelName);
              expect(notification.data).to.eql(models[0]);
              done();
            });

            transceiver.onObjectDeleted(modelName, models[0]);
          });
        });
      });
    });
  });
});
