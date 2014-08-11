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
    it('should send an HTTP request through the socket and get a 404', function(done) {
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

    it('should send an HTTP request through the socket and get a 200', function(done) {
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

  });
});
