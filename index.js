const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET);


const port = process.env.PORT || 5001;

const app = express();

// middleware
app.use(cors());
app.use(express.json());


// database connection
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@complete-projects.f8rypku.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// jwt middleware

function verifyJWT(req, res, next) {
    console.log("access token inside jwt", req.headers.authorization);
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send("unauthorized access");
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: "forbidden access" })
        }
        req.decoded = decoded;
        next();
    })
}



async function run() {
    try {
        // services data collection
        const servicesCollection = client.db("cctvShop").collection("cctvServices");

        // data collection from the post request which is submitted by the customer
        const bookingsCollection = client.db("cctvShop").collection("servicesBooking");

        // users Collection 
        const usersCollection = client.db("cctvShop").collection("users");

        // technicians Collection
        const techniciansCollection = client.db("cctvShop").collection("technicians");
        
        
        // payments Collection
        const paymentsCollection = client.db("cctvShop").collection("payments");


        // verifyAdmin after verifyJWT
        const verifyAdmin = async (req, res, next) => {
            console.log("inside verifyAdmin", req.decoded.email);
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user?.role !== "admin") {
                return res.status(403).send({ message: "forbidden access" })
            }
            next()
        }



        // load the services data from the database
        app.get("/services", async (req, res) => {
            const query = {};
            const result = await servicesCollection.find(query).toArray();
            res.send(result);
        })


        // get the bookings for dashboard && verify json web token (JWT)
        app.get("/servicesBooking", verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'Invalid' })
            }
            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);
        })

        // customer services from the frontend to backend
        // Here bookings are filtering for individual booking and show the individual data
        // 

        app.post("/servicesBooking", async (req, res) => {
            const bookingService = req.body;
            console.log(bookingService)
            const query = {
                date: bookingService.date,
                email: bookingService.email,
                serviceName: bookingService.serviceName
            };

            const alreadyBooked = await bookingsCollection.find(query).toArray();

            if (alreadyBooked.length) {
                const message = `You already have a booking on ${bookingService.date}`;
                return res.send({ acknowledged: false, message });
            }

            const result = await bookingsCollection.insertOne(bookingService);
            res.send(result);
        });

        // payment request
        app.get("/servicesBooking/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingsCollection.findOne(query);
            res.send(booking);
        })

        // payment gateway

        app.post("/create-payment-intent", async (req, res) => {
            const serviceBooking = req.body;
            const price = serviceBooking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: "usd",
                amount: amount,
                "payment_method_types": [
                    "card"
                ]

            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        // payment save to the database
        app.post("/payments", async (req, res) => {
            const payment = req.body;
            const result = await paymentCollection.insertOne(payment);
            const id = payment.bookingId
            const filter = {_id : ObjectId(id)}
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updateResult = await bookingsCollection.updateOne(filter, updatedDoc);
            res.send(result);
        })

        // generate JWT when sign up
        app.get("/jwt", async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: "1h" });
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accessToken: "" })
        })


        // get all users from the database

        app.get("/users", async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray();
            res.send(users);
        })

        // check the particular user admin or not
        app.get("/users/admin/:email", async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === "admin" });
        })


        // upload users into the database
        app.post("/users", async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })


        // update role in database 

        app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {

            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: "admin"
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        });

        // temporary to update price field on service options
        // app.get("/addPrice", async (req, res) => {
        //     const filter = {};
        //     const options = {upsert: true};
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     };
        //     const result = await servicesCollection.updateMany(filter, updatedDoc, options);
        //     res.send(result);
        // })

        // get only the services name from the database

        app.get("/serviceSpecialty", async (req, res) => {
            const query = {};
            const result = await servicesCollection.find(query).project({ serviceName: 1 }).toArray();
            res.send(result);
        });

        // get all the technicians
        app.get("/technicians", async (req, res) => {
            const query = {};
            const technicians = await techniciansCollection.find(query).toArray();
            res.send(technicians)
        })


        // post technicians detail to the database
        app.post("/technician", verifyJWT, verifyAdmin, async (req, res) => {
            const technician = req.body;
            const result = await techniciansCollection.insertOne(technician);
            res.send(result);
        })

        // delete technicians
        app.delete("/technicians/:id", verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await techniciansCollection.deleteOne(filter);
            res.send(result)
        })

    }


    finally {

    }

}
run().catch(console.dir);




app.get("/", (req, res) => {
    res.send("CCTV server is running successfully");
})

app.listen(port, () => {
    console.log("We are listening", port)
})