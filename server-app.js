require('dotenv').config();
const express = require('express');
const app = express();
const mongoose = require('mongoose');
const cors = require('cors');
const Schema = mongoose.Schema;
const bcrypt = require('bcrypt');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const uploader = require('./cloudinary-setup');
const path = require("path");

app.use(express.static(path.join(__dirname, 'build')));
///////////////////////////////////////////////////// Body parser /////////////////////////////////////////////////////

var bodyParser = require('body-parser'); 
app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));

///////////////////////////////////////////////////// Connect to DB /////////////////////////////////////////////////////

mongoose.connect(process.env.MONGODB_URI)
        .then(x => {
            console.log(`Connected to Mongo! Database name: "${x.connections[0].name}"`)
        })
        .catch(err => {
            console.error('Error connecting to mongo', err)
        });

///////////////////////////////////////////////////// CORS /////////////////////////////////////////////////////

app.use(cors({
    origin: ['http://localhost:3000', 'https://api.rss2json.com/'],
    credentials: true
}))

///////////////////////////////////////////////////// Sessions /////////////////////////////////////////////////////

var store = new MongoDBStore({
    uri: 'mongodb://localhost:27017/spotted',
    collection: 'mySessions'
  });
  
  app.use(session({
    secret: 'This is a secret',
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
    },
    store: store,
    resave: true,
    saveUninitialized: false
  }));

///////////////////////////////////////////////////// Models /////////////////////////////////////////////////////

const stringToObjectId = string => mongoose.Types.ObjectId(string);

let userSchema = new Schema({
    username: String,
    firstname: String,
    lastname: String,
    email: String,
    password: String,
    car: String,
    camera: String,
    spots: [{
        type: Schema.Types.ObjectId,
        ref: 'spots',
        set:  stringToObjectId
    }]
})

const User = mongoose.model('users', userSchema)

let spotSchema = new Schema({
    car: String,
    type: String,
    engine: String,
    horsepower: Number,
    image: String,
    ratingCount: { type: Number, default: 0 },
    ratings: Array,
    userRating: Array,
    comments: [{
        type: Schema.Types.ObjectId,
        ref: 'comments',
        set:  stringToObjectId
    }],
    author: {
        type: Schema.Types.ObjectId,
        ref: 'users',
        set:  stringToObjectId
    }
})

const Spot = mongoose.model('spots', spotSchema)

let commentSchema = new Schema({
    author: {
        type: Schema.Types.ObjectId,
        ref: 'users',
        set: stringToObjectId
    },
    spot: {
        type: Schema.Types.ObjectId,
        ref: 'spots',
        set: stringToObjectId
    },
    comment: String
})

const Comment = mongoose.model('comments', commentSchema)

///////////////////////////////////////////////////// Comments /////////////////////////////////////////////////////

app.post('/single-spot/:id/comment', (req, res) => {debugger
    req.body.author = req.session.user._id.toString();
    req.body.spot = req.params.id
    Comment.create(req.body)
        .then(result => {debugger
            console.log(result)
            Spot.findByIdAndUpdate(req.params.id, {$push: {comments: result.id}})
                .then(newComment => {debugger
                    res.json({ message: 'Comment created' });
                })
        })
        .catch(err => {debugger
            res.json(err)
            console.log(err)
        })
})

///////////////////////////////////////////////////// Sign up /////////////////////////////////////////////////////

app.post('/sign-up', (req, res) => {
    let user = req.body;
    let hash = bcrypt.hashSync(user.password, 10);
    user.password = hash;
    User.create(user)
        .then(result => {
            res.json({message: 'User created'});
            console.log(result);
        })
        .catch(err => {
            res.json(err);
            console.log(err);
        })
});

///////////////////////////////////////////////////// Creating spot /////////////////////////////////////////////////////

app.post('/upload', uploader.single("image"), (req, res, next) => {
    if(!req.file) {
        next(new Error('No file uploaded!'));
        return;
    }
    res.json({ secure_url: req.file.secure_url });
});

app.post('/create-spot/:id', (req, res) => {
    req.body.author = req.params.id
    console.log(req.body)
    Spot.create(req.body)
        .then(result => {
            User.findByIdAndUpdate(req.params.id, {$push: {spots: result.id}})
            .then(newUser => {
                res.json({ message: 'Spot created' });
            })
        })
        .catch(err => {
            res.json(err);
            console.log(err)
        })
})

///////////////////////////////////////////////////// Log in /////////////////////////////////////////////////////

app.post('/log-in', (req, res) => {
    User.findOne({username: req.body.username})
        .then(result => {
            if(!result) {
                res.status(403).json({errorMessage: 'Invalid credentials'})
                return
            }
            if(bcrypt.compareSync(req.body.password, result.password)) {
                req.session.user = result._doc;
                const {password, ...user} = result._doc;
                res.status(200).send({user: user}) 
            } else {
                res.status(401).json({errorMessage: 'Invalid credentials'})
            }
        })
        .catch(err => {
            res.status(500).json({errorMessage: err})
        })
})

app.get("/profile", (req, res)=> {
    debugger
    if(req.session.user) {
      res.json(req.session.user)
    } else {
      res.status(403).json({message: "Unauthorized"})
    }
})

///////////////////////////////////////////////////// Edit profile /////////////////////////////////////////////////////

app.post('/profile/edit/:id', (req, res) => {
    User.findByIdAndUpdate(req.params.id, req.body)
        .then(response => {
            res.status(200).json(response)
        })
        .catch(err => {
            res.status(500).json(err)
        })
})

///////////////////////////////////////////////////// Listing all spots /////////////////////////////////////////////////////

app.get('/all-spots', (req, res) => {
    Spot.find({}).populate('author')
        .then(result => {
        res.status(200).json(result)
        })
        .catch(err => {
        res.status(500).json(err)
    })
})

///////////////////////////////////////////////////// Spots by user /////////////////////////////////////////////////////

app.get('/profile/:id/spots', (req, res) => {
    User.findOne({_id: req.params.id}).populate('spots')
        .then(result => {
            res.status(200).json(result)
        })
        .catch(err => {
            res.status(500).json(err)
        })
})

///////////////////////////////////////////////////// Single spot /////////////////////////////////////////////////////

app.get('/single-spot/:id', (req, res) => {
    if(req.params.id) {
        Spot.findOne({_id: req.params.id}).populate('author').populate({path:"comments", populate: {path:"author"}} )
            .then(result => {
                res.status(200).json(result)
            })
            .catch(err => {
                res.status(500).json(err)
            })
    }
})

///////////////////////////////////////////////////// Delete single spot /////////////////////////////////////////////////////

app.post('/single-spot/:id/delete', (req, res) => {
    if(req.session.user._id ) {
        Spot.findOne({_id: req.params.id})
        .then(result => {
            if(req.session.user._id.toString() === result.author.toString()) {
                Spot.findByIdAndDelete({_id: req.params.id})
                    .then(result => {
                        console.log(result);
                    })
                    .catch(err => {
                        console.log(err);
                    })
            }
            res.status(200).json(result)
        })
        .catch(err => {
            res.status(500).json(err)
        })
    }
})

///////////////////////////////////////////////////// Rating of spot /////////////////////////////////////////////////////

app.post('/single-spot/:id', (req, res) => {
    let userId = req.session.user._id.toString();
    debugger
    if(req.body.star > 0) {
        Spot.findOneAndUpdate({_id: req.params.id, userRating: {$nin: [userId]}}, 
                               {$inc: {ratingCount: 1},$push: {ratings: req.body.star, userRating: userId}},
                               {new: true})
            .then(response => {
                debugger
                res.status(200).json(response)
            })
            .catch(err => {
                debugger
                res.status(500).json(err)
            })
    }
})

///////////////////////////////////////////////////// Log out /////////////////////////////////////////////////////

app.get("/log-out",(req,res)=>{
    req.session.destroy();
})
  

const port = 5000;

app.listen(port, () => console.log(`server started on port ${port}`));