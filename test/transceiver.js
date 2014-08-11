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

function createServer(cb) {
  var app = express();
  var server = require('http').Server(app);
  transceiver(server, app);

  server.listen(function() {
    cb(app, server);
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
});
