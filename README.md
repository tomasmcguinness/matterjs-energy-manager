# Matter Energy Manager

I'm trying to create a Matter Device Energy Manager to learn more about Matter's energy management protocol. This project will serve as the DEM part of the energy management. 

You will need a Matter device that supports the device energy management cluster. I have been building one using the esp-matter framework. You can find that project https://github.com/tomasmcguinness/matter-esp32-tiny-dishwasher

This project uses matterjs and uses nextJs for the frontend and nodeJs for the backend.

## Simulators

If you don't have hardware, there are four matter.js simulators that each run as a standalone app:

| Simulator | UI | Manual pairing code |
|---|---|---|
| [matterjs-heat-pump](https://github.com/tomasmcguinness/matterjs-heat-pump) | http://localhost:5001 | 3497-011-2332 |
| [matterjs-dishwasher](https://github.com/tomasmcguinness/matterjs-dishwasher) | http://localhost:6001 | 3497-021-2338 |
| [matterjs-washing-machine](https://github.com/tomasmcguinness/matterjs-washing-machine) | http://localhost:7001 | 3497-031-2335 |
| [matterjs-solar-inverter](https://github.com/tomasmcguinness/matterjs-solar-inverter) | http://localhost:8001 | 3497-041-2336 |

## Energy management

The backend looks for the Device Energy Management cluster on every endpoint of every node, including nested endpoints such as a heat pump's or solar inverter's children. For each one it subscribes to the forecast and opt-out state. The Energy page shows one forecast per DEM endpoint.

**Optimise** goes through every DEM endpoint that meets all of these conditions:

- it supports Start Time Adjustment;
- it hasn't opted out of local optimisation;
- it has a forecast with a start window.

For each one, it finds the cheapest start minute by minute between `earliestStartTime` and `latestEndTime − duration`, prices it against the tariff, and sends `StartTimeAdjustRequest` with cause `LocalOptimization`. Devices that only report forecasts, such as the heat pump, solar and battery, are shown but not adjusted.

matter.js takes epoch-s values as Unix seconds and converts them to and from the Matter epoch on the wire, so the backend works in Unix seconds throughout.

## Running
To run this, you'll need to start both the frontend and backend.

For the backend
```
cd Backend
node app.js
```

For the frontend

```
cd Frontend
npm run dev
```

This code is rough around the edges, but should work!

I haven't tried it with bluetooth, so you will need to ensure your devices are on-network when commissioning.
