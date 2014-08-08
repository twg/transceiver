# Transceiver

Transceiver adds real-time
[pubsub](http://en.wikipedia.org/wiki/Publish%E2%80%93subscribe_pattern)
functionality to your [Express.js](http://expressjs.com) app and optionally
integrates with an Angular.js frontend. Based off of ideas (and code) from
[Sails.js](http://sailsjs.org), Transceiver lets you do things like this on
your server:

    app.get('/api/v1/users', function (req, res, next) {
      User.find().then(function(users) {
        res.json(users);
        if (res.io) {
          res.io.subscribe('User');
        }
      });
    });

    app.post('/api/v1/users', function (req, res, next) {
      User.create(req.query).then(function(user) {
        res.json(user);
        if (res.io) {
          res.io.publishCreate('User', user);
        }
      });
    });


And things like this on your frontend (Angular in this case):

    socket.get('/api/v1/users', function(users) {
        console.log("Users are:", users);
        $scope.$on("create:user", function(user) {
            console.log("New user created:", user);
        });
    });

Tranceiver is currently considered an *alpha library*, meaning that it's
not ready for embedding in production projects just yet.