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
});
