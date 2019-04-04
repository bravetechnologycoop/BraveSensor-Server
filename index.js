const express = require('express');
const bodyParser = require('body-parser');
const db = require('./db/db.js');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const fs = require('fs');
const cors = require('cors');
const httpSignature = require('http-signature');
const smartapp   = require('@smartthings/smartapp');
require('dotenv').config();

const app = express();
const port = 3000
const http = require('http').Server(app);
const io = require('socket.io')(http);

let SessionState = require('./SessionState.js');

var locations = ["BraveOffice"];

var voidStates = ["MOVEMENT"]
var triggerStates = ["DOOR_OPENS"]
var closingStates = ["OVERDOSE_ATTENDED"]


// Body Parser Middleware
app.use(bodyParser.urlencoded({extended: true})); // Set to true to allow the body to contain any type of vlue
app.use(bodyParser.json()); 
app.use(express.json()); // Used for smartThings wrapper

// Cors Middleware (Cross Origin Resource Sharing)
app.use(cors());

// SmartThings Smart App Implementations

// @smartthings_rsa.pub is your on-disk public key
// If you do not have it yet, omit publicKey()
smartapp
    .publicKey('@smartthings_rsa.pub') // optional until app verified
    .configureI18n()
    .page('mainPage', (context, page, configData) => {
        page.name('ODetect Configuration App');
        page.section('Location and Devices information', section => {
            section.textSetting('LocationID');
            section.textSetting('DeviceID');
        });
        page.section('Select sensors', section => {
            section.deviceSetting('contactSensor').capabilities(['contactSensor']).required(false);
            section.deviceSetting('motionSensor').capabilities(['motionSensor']).required(false);
            section.deviceSetting('button').capabilities(['button']).required(false);
        });
    })
    .installed((context, installData) => {
        console.log('installed', JSON.stringify(installData));
    })
    .uninstalled((context, uninstallData) => {
        console.log('uninstalled', JSON.stringify(uninstallData));
    })
    .updated((context, updateData) => {
        console.log('updated', JSON.stringify(updateData));
        context.api.subscriptions.unsubscribeAll().then(() => {
              console.log('unsubscribeAll() executed');
              context.api.subscriptions.subscribeToDevices(context.config.contactSensor, 'contactSensor', 'contact', 'myContactEventHandler');
              context.api.subscriptions.subscribeToDevices(context.config.motionSensor, 'motionSensor', 'motion', 'myMotionEventHandler');
              context.api.subscriptions.subscribeToDevices(context.config.button, 'button', 'button', 'myButtonEventHandler');
        });
    })
    .subscribedEventHandler('myContactEventHandler', (context, deviceEvent) => {
        const signal = deviceEvent.value;
        const LocationID = context.event.eventData.installedApp.config.LocationID[0].stringConfig.value;
        const DeviceID = context.event.eventData.installedApp.config.DeviceID[0].stringConfig.value;
        db.addDoorSensordata(DeviceID, LocationID, "Door", signal);
        console.log(`Motion${DeviceID} Sensor: ${signal} @${LocationID}`);
    })
    .subscribedEventHandler('myMotionEventHandler', (context, deviceEvent) => {
        const signal = deviceEvent.value;
        const LocationID = context.event.eventData.installedApp.config.LocationID[0].stringConfig.value;
        const DeviceID = context.event.eventData.installedApp.config.DeviceID[0].stringConfig.value;
        db.addMotionSensordata(DeviceID, LocationID, "Motion", signal);
        console.log(`Motion${DeviceID} Sensor: ${signal} @${LocationID}`);
    })
    .subscribedEventHandler('myButtonEventHandler', (context, deviceEvent) => {
        const signal = deviceEvent.value;
        const LocationID = context.event.eventData.installedApp.config.LocationID[0].stringConfig.value;
        const DeviceID = context.event.eventData.installedApp.config.DeviceID[0].stringConfig.value;
        console.log(`Button${DeviceID} Sensor: ${signal} @${LocationID}`);
    })

// Handler for income SmartThings POST requests
app.post('/api/st', function(req, res, next) {
    smartapp.handleHttpCallback(req, res);
});

// Handler for income XeThru POST requests
app.post('/api/xethru', async (req, res) => {
    db.addXeThruSensordata(req, res); 
});


// Web Socket connection to Frontend

io.on('connection', (socket) => {
    console.log("Frontend Connected")
    socket.emit('Hello', {
        greeting: "Hello ODetect Frontend"
    });
});

// Used for Frontend example. Every 1.5 seconds sends the three sensors' raw data to the frontend

/* setInterval(async function () {
    let XeThruData = await db.getLatestXeThruSensordata();
    let MotionData = await db.getLatestMotionSensordata();
    let DoorData = await db.getLatestDoorSensordata();
    //let sessionstate = await db.getLastUnclosedSessionFromLocationID();
    //sessionstate.stateMachine();
    io.sockets.emit('xethrustatedata', {data: XeThruData});
    io.sockets.emit('motionstatedata', {data: MotionData});
    io.sockets.emit('doorstatedata', {data: DoorData});
    //io.sockets.emit('sessionstatedata', {data: sessionstate});
}, 1500); // Set to transmit data every 1000 ms. */

setInterval(async function () {
  for(let i = 0; i < locations.length; i++){
    let currentState = "SessionState"; //State Machine function
    let prevState = db.getLatestStateMachineData(locations[i]);
     // To avoid filling the DB with repeated states in a row.
    if(currentState != prevState.state){
      db.addStateMachineData(currentState, locations[i]);
      //Checks if current state belongs to voidStates
      if(voidStates.includes(currentState)){
        latestSession = db.getMostRecentSession(locations[i]);
        if(latestSession.end_time == null){ //Checks if session is open. 
          let currentSession = db.updateSessionState(latestSession.sessionid, currentState, locations[i]);
          io.sockets.emit('sessiondata', {data: currentSession});
        }
        break;
      }
      // Checks if current state belongs to the session triggerStates
      else if(triggerStates.includes(currentState)){
        let currentSession = db.createSession(env.PHONENUMBER, locations[i], currentState);
        io.sockets.emit('sessiondata', {data: currentSession});
      } 
      // Checks if current state belongs to the session closingStates
      else if(closingStates.includes(currentState)){
        latestSession = db.getMostRecentSession(locations[i]);
        let currentSession = db.updateSessionState(latestSession.sessionid, currentState, locations[i]); //Adds the closing state to session
        if(db.closeSession(locations[i])){ // Adds the end_time to the latest open session from the LocationID
          console.log(`Session at ${locations[i]} was close successfully.`);
          io.sockets.emit('sessiondata', {data: currentSession}); // Sends currentSession data with end_time which will close the session in the frontend
        }
        else{
          console.log(`No open session was found for ${locations[i]}`);
        }
      }
      else{
        console.log("Current State does not belong to any of the States groups");
      }
    }

  }
}, 1500); // Set to transmit data every 1500 ms.


//Setting the app to listen
const server = app.listen(port, () => {
  console.log(`App running on port ${port}.`)
})

io.listen(server);

