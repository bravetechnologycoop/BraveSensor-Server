const { helpers } = require('brave-alert-lib')
const stateMachineHelpers = require('./stateMachineHelpers')
const redis = require('../db/redis')
const ALERT_REASON = require('../AlertReasonEnum')
const DOOR_STATUS = require('../SessionStateDoorEnum')
const STATE = require('./SessionStateEnum')

async function getNextState(location, handleAlert) {

  try {
    let state
    let transaction = redis.multi()
    // await redis.beginTransaction()
    const door = await transaction.getLatestDoorSensorData(location.locationid)
    const stateData = await transaction.getLatestState(location.locationid)
    if (!stateData) {
      state = null
    } else {
      state = stateData.state
    }
    const movementOverThreshold = await stateMachineHelpers.movementAverageOverThreshold(
      location.radarType,
      location.locationid,
      location.movementThreshold,
    )

    switch (state) {
      case STATE.IDLE:
        if (door.signal === DOOR_STATUS.CLOSED && movementOverThreshold) {
          await transaction.addStateMachineData(STATE.INITIAL_TIMER, location.locationid)
        }
        break
      case STATE.INITIAL_TIMER:
        if (door.signal === DOOR_STATUS.OPEN || !movementOverThreshold) {
          await transaction.addStateMachineData(STATE.IDLE, location.locationid)
        } else if (await stateMachineHelpers.timerExceeded(location.locationid, parseInt(location.initialTimer, 10), STATE.INITIAL_TIMER)) {
          await transaction.addStateMachineData(STATE.DURATION_TIMER, location.locationid)
        }
        break
      case STATE.DURATION_TIMER:
        if (door.signal === DOOR_STATUS.OPEN) {
          await transaction.addStateMachineData(STATE.IDLE, location.locationid)
        } else if (!movementOverThreshold) {
          await transaction.addStateMachineData(STATE.STILLNESS_TIMER, location.locationid)
        } else if (
          await stateMachineHelpers.timerExceeded(
            location.locationid,
            parseInt(location.durationTimer, 10) + parseInt(location.initialTimer, 10),
            STATE.INITIAL_TIMER,
          )
        ) {
          await handleAlert(location, ALERT_REASON.DURATION)
          await transaction.addStateMachineData(STATE.IDLE, location.locationid)
        }
        break
      case STATE.STILLNESS_TIMER:
        if (door.signal === DOOR_STATUS.OPEN) {
          await transaction.addStateMachineData(STATE.IDLE, location.locationid)
        } else if (movementOverThreshold) {
          await transaction.addStateMachineData(STATE.DURATION_TIMER, location.locationid)
        } else if (await stateMachineHelpers.timerExceeded(location.locationid, parseInt(location.stillnessTimer, 10), STATE.STILLNESS_TIMER)) {
          await handleAlert(location, ALERT_REASON.STILLNESS)
          await transaction.addStateMachineData(STATE.IDLE, location.locationid)
        } else if (
          await stateMachineHelpers.timerExceeded(
            location.locationid,
            parseInt(location.durationTimer, 10) + parseInt(location.initialTimer, 10),
            STATE.INITIAL_TIMER,
          )
        ) {
          await handleAlert(location, ALERT_REASON.DURATION)
          await transaction.addStateMachineData(STATE.IDLE, location.locationid)
        }
        break
      default:
        await transaction.addStateMachineData(STATE.IDLE, location.locationid)
        break
    }
    transaction.exec((err) => {`Error in redis transaction: ${err}`})
  } catch (err) {
    helpers.log(`Error in StateMachine.getNextState(): ${err}`)
  }
}

module.exports = {
  getNextState,
}
