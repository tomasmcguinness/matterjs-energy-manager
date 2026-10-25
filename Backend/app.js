import { Environment, StorageService } from "@matter/main";
import { CommissioningController } from "@project-chip/matter.js";
import { ManualPairingCodeCodec } from "@matter/main/types";
import express from "express";
import http from "http"
import { Server } from "socket.io";
import cors from "cors";
import { Diagnostic, NodeId } from "@matter/main";
import { GeneralCommissioning, OperationalState } from "@matter/main/clusters";
import { DeviceEnergyManagement, DescriptorCluster } from "@matter/main/clusters";
import { NodeStates } from "@project-chip/matter.js/device";

const app = express();
app.use(express.json());
// Matter values (node ids, energy, power) can be bigint, which JSON can't represent natively.
app.set("json replacer", (_key, value) => typeof value === "bigint" ? Number(value) : value);
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:4001",
        methods: ["GET", "POST"]
    }
});

app.get("/status", (request, response) => {
    const status = {
        "Status": "Running"
    };

    response.send(status);
});

io.on('connection', (socket) => {
    console.log('a user connected');
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
    console.log("Server Listening on PORT:", PORT);
});

/*
 * Stand up the Matter Controller
 */
const environment = Environment.default;

const storageService = environment.get(StorageService);

const uniqueId = "EnergyManager";

const adminFabricLabel = "matter.js Controller";

const commissioningController = new CommissioningController({
    environment: {
        environment,
        id: uniqueId,
    },
    autoConnect: false, // Do not auto connect to the commissioned nodes
    adminFabricLabel,
});

const controllerStorage = (await storageService.open("controller")).createContext("data");

await controllerStorage.set("fabriclabel", adminFabricLabel);

console.log(`Starting controller...`);

await commissioningController.start();

let nodes = await commissioningController.getCommissionedNodes();

/*
 * Device Energy Management endpoints, discovered on every node when it connects.
 * Keyed by "nodeId/endpointId".
 */
const demEndpoints = new Map();

const demKey = (nodeId, endpointId) => `${nodeId}/${endpointId}`;

// Matter attributes can contain bigint values, which JSON (and socket.io) can't serialise.
const toJson = (value) => value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, v) => typeof v === "bigint" ? Number(v) : v));

/** All endpoints of a node, including nested parts such as a heat pump's or solar inverter's children. */
const allEndpoints = (node) => {
    const result = [];
    const visit = (endpoint) => {
        result.push(endpoint);
        for (const part of endpoint.parts.values()) {
            visit(part);
        }
    };
    node.getDevices().forEach(visit);
    return result;
};

const describeDemEndpoint = (entry) => ({
    nodeId: entry.nodeId,
    endpointId: entry.endpointId,
    deviceTypes: entry.deviceTypes,
    esaType: entry.esaType,
    esaCanGenerate: entry.esaCanGenerate,
    esaState: entry.esaState,
    features: entry.features,
    optOutState: entry.optOutState,
    forecast: toJson(entry.forecast),
});

/** Finds every endpoint with a DEM cluster and subscribes to its forecast and opt-out state. */
const discoverDemEndpoints = async (nodeId, node) => {
    for (const endpoint of allEndpoints(node)) {

        const deviceEnergyManagement = endpoint.getClusterClient(DeviceEnergyManagement.Complete);

        if (!deviceEnergyManagement) {
            continue;
        }

        const key = demKey(nodeId, endpoint.number);
        const known = demEndpoints.get(key);
        const entry = known ?? { nodeId: nodeId.toString(), endpointId: endpoint.number };

        entry.client = deviceEnergyManagement;
        entry.features = deviceEnergyManagement.supportedFeatures;

        const descriptor = endpoint.getClusterClient(DescriptorCluster);
        entry.deviceTypes = descriptor ? (await descriptor.getDeviceTypeListAttribute()).map(dt => dt.deviceType) : [];
        entry.esaType = await deviceEnergyManagement.getEsaTypeAttribute();
        entry.esaCanGenerate = await deviceEnergyManagement.getEsaCanGenerateAttribute();
        entry.esaState = await deviceEnergyManagement.getEsaStateAttribute();
        entry.forecast = await deviceEnergyManagement.getForecastAttribute();

        // OptOutState only exists when the device supports an adjustment feature.
        const adjustable = entry.features.powerAdjustment || entry.features.startTimeAdjustment || entry.features.pausable
            || entry.features.forecastAdjustment || entry.features.constraintBasedAdjustment;
        entry.optOutState = adjustable ? await deviceEnergyManagement.getOptOutStateAttribute() : undefined;

        demEndpoints.set(key, entry);

        // Listeners survive reconnects, so only add them the first time this endpoint is seen.
        if (!known) {
            deviceEnergyManagement.addForecastAttributeListener(value => {
                console.log(`Forecast updated for ${key}`, Diagnostic.json(value));
                entry.forecast = value;
                io.emit("forecast", { nodeId: entry.nodeId, endpointId: entry.endpointId, forecast: toJson(value) });
            });

            deviceEnergyManagement.addEsaStateAttributeListener(value => {
                entry.esaState = value;
                io.emit("esaState", { nodeId: entry.nodeId, endpointId: entry.endpointId, value });
            });

            if (adjustable) {
                deviceEnergyManagement.addOptOutStateAttributeListener(value => {
                    entry.optOutState = value;
                    io.emit("optOutState", { nodeId: entry.nodeId, endpointId: entry.endpointId, value });
                });
            }
        }

        io.emit("demEndpoint", describeDemEndpoint(entry));
    }
};

/** Subscribes to a commissioned node's events and connects to it. */
const setupNode = async (nodeId) => {
    const node = await commissioningController.getNode(nodeId);

    node.events.attributeChanged.on(({ path: { nodeId, clusterId, endpointId, attributeName }, value }) => {

        if (clusterId === OperationalState.id) {
            io.emit("operationalState", { nodeId: nodeId.toString(), endpointId, attributeName, value: toJson(value) });
        }

        console.log(`attributeChangedCallback ${nodeId}: Attribute ${endpointId}/${clusterId}/${attributeName} changed to ${Diagnostic.json(value)}`);
    });

    node.events.stateChanged.on(async (info) => {
        switch (info) {
            case NodeStates.Connected:
                console.log(`state changed: Node ${nodeId} connected!`);

                await discoverDemEndpoints(nodeId, node).catch(error => console.error(`DEM discovery failed for node ${nodeId}`, error));

                io.emit("status", nodeId.toString());
                break;
            case NodeStates.Disconnected:
                console.log(`state changed: Node ${nodeId} disconnected`);
                io.emit("status", nodeId.toString());
                break;
            case NodeStates.Reconnecting:
                console.log(`state changed: Node ${nodeId} reconnecting`);
                io.emit("status", nodeId.toString());
                break;
            case NodeStates.WaitingForDeviceDiscovery:
                console.log(`state changed: Node ${nodeId} waiting for device discovery`);
                io.emit("status", nodeId.toString());
                break;
        }
    });

    // A node that was just commissioned is already connected, so the Connected state won't be reported again.
    if (node.isConnected) {
        await discoverDemEndpoints(nodeId, node).catch(error => console.error(`DEM discovery failed for node ${nodeId}`, error));
    } else {
        node.connect();
    }
};

nodes.forEach(setupNode);

app.get("/devices", async (request, response) => {

    const nodeDetails = commissioningController.getCommissionedNodes();

    let mapResult = nodeDetails.map(async (nodeId) => {

        const node = await commissioningController.getNode(nodeId);

        var endpoint = node.getRootEndpoint();

        const descriptorCluster = endpoint.getClusterClient(DescriptorCluster);

        const partsList = await descriptorCluster.getPartsListAttribute();

        var deviceTypes = [];

        // The root parts list includes nested endpoints, which getDeviceById() doesn't return.
        const endpointsByNumber = new Map(allEndpoints(node).map(e => [e.number, e]));

        for (const endpointId of partsList) {

            const endpoint = endpointsByNumber.get(endpointId);

            if (!endpoint) {
                continue;
            }

            // Get the Descriptor cluster client
            const descriptorCluster = endpoint.getClusterClient(DescriptorCluster);

            // Retrieve the device type list
            const deviceTypeList = await descriptorCluster.getDeviceTypeListAttribute();

            for (const deviceType of deviceTypeList) {
                if (!deviceTypes.includes(deviceType.deviceType)) {
                    deviceTypes.push(deviceType.deviceType)
                }
            }
        }

        return {
            id: nodeId.toString(), state: node.connectionState,
            manufacturer: node?.basicInformation?.vendorName,
            productName: node?.basicInformation?.productName, 
            deviceTypes, 
        }
    });

    const devices = await Promise.all(mapResult);

    response.send(devices);
});

app.post("/devices", async (request, response) => {

    let data = request.body;

    let setupPin, shortDiscriminator;

    const pairingCodeCodec = ManualPairingCodeCodec.decode(data.manualSetupCode);
    shortDiscriminator = pairingCodeCodec.shortDiscriminator;
    setupPin = pairingCodeCodec.passcode;

    console.log(`Data extracted from pairing code: ${Diagnostic.json(pairingCodeCodec)}`);

    const commissioningOptions = {
        regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
        regulatoryCountryCode: "XX",
    };

    const options = {
        commissioning: commissioningOptions,
        discovery: {
            identifierData: { shortDiscriminator }
        },
        passcode: setupPin,
    };

    console.log(`Commissioning ... ${Diagnostic.json(options)}`);

    const nodeId = await commissioningController.commissionNode(options);

    console.log(`Commissioning successfully done with nodeId ${nodeId}`);

    await setupNode(nodeId);

    response.send({ nodeId: nodeId.toString() });
});

app.get("/devices/:nodeId", async (request, response) => {

    const { nodeId } = request.params;

    const node = await commissioningController.getNode(NodeId(nodeId));

    response.send({
        id: nodeId.toString(),
        state: node.connectionState,
        manufacturer: node?.basicInformation?.vendorName,
            productName: node?.basicInformation?.productName,
    });
});

app.get("/devices/:nodeId/energy", async (request, response) => {

    const { nodeId } = request.params;

    const endpoints = [...demEndpoints.values()].filter(entry => entry.nodeId === nodeId).map(describeDemEndpoint);

    response.send(endpoints);
});

// Returns the forecast of the node's first DEM endpoint.
app.get("/devices/:nodeId/forecast", async (request, response) => {

    const { nodeId } = request.params;

    const entry = [...demEndpoints.values()].find(entry => entry.nodeId === nodeId && entry.forecast);

    if (entry) {
        response.send(toJson(entry.forecast));
    } else {
        console.log('No forecast available for device. Return 204');
        response.status(204).send();
    }
});

app.get("/devices/:nodeId/endpoints/:endpointId/forecast", async (request, response) => {

    const { nodeId, endpointId } = request.params;

    const entry = demEndpoints.get(demKey(nodeId, endpointId));

    if (entry?.forecast) {
        response.send(toJson(entry.forecast));
    } else {
        response.status(204).send();
    }
});

app.get("/energy/devices", async (request, response) => {
    response.send([...demEndpoints.values()].map(describeDemEndpoint));
});

app.delete("/devices/:nodeId", async (request, response) => {

    const { nodeId } = request.params;

    let node = await commissioningController.getNode(NodeId(nodeId));

    await node.decommission();

    for (const [key, entry] of demEndpoints) {
        if (entry.nodeId === nodeId) {
            demEndpoints.delete(key);
        }
    }

    response.status(204).send();
});

let tariffStructure = [
    { hour: 0, startMinute: 0, endMinute: 29, price: 7.5 },
    { hour: 0, startMinute: 30, endMinute: 59, price: 7.5 },
    { hour: 1, startMinute: 0, endMinute: 29, price: 7.5 },
    { hour: 1, startMinute: 30, endMinute: 59, price: 7.5 },
    { hour: 2, startMinute: 0, endMinute: 29, price: 7.5 },
    { hour: 2, startMinute: 30, endMinute: 59, price: 7.5 },
    { hour: 3, startMinute: 0, endMinute: 29, price: 7.5 },
    { hour: 3, startMinute: 30, endMinute: 59, price: 7.5 },
    { hour: 4, startMinute: 0, endMinute: 29, price: 7.5 },
    { hour: 4, startMinute: 30, endMinute: 59, price: 7.5 },
    { hour: 5, startMinute: 0, endMinute: 29, price: 7.5 },
    { hour: 5, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 6, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 6, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 7, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 7, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 8, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 8, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 9, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 9, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 10, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 10, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 11, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 11, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 12, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 12, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 13, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 13, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 14, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 14, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 15, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 15, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 16, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 16, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 17, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 17, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 18, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 18, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 19, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 19, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 20, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 20, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 21, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 21, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 22, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 22, startMinute: 30, endMinute: 59, price: 28 },
    { hour: 23, startMinute: 0, endMinute: 29, price: 28 },
    { hour: 23, startMinute: 30, endMinute: 59, price: 7.5 },
    { hour: 0, startMinute: 0, endMinute: 29, price: 7.5 },
];

const generateTariff = (currentTime) => {

    let tariffSlots = [];

    let currentDate = new Date();

    tariffStructure.forEach(element => {
        let startDate = currentDate.setHours(element.hour, element.startMinute, 0, 0);
        tariffSlots.push({ startDate: startDate, price: element.price });
    });

    return tariffSlots;
}

app.get("/tariff", async (request, response) => {
    var tariff = generateTariff(Math.floor(Date.now() / 1000));
    response.send(tariff);
});

app.get("/tariff/configuration", async (request, response) => {
    response.send(tariffStructure);
});

app.post("/tariff/configuration", async (request, response) => {
    console.log(request.query.id);

    tariffStructure[request.query.id].price = tariffStructure[request.query.id].price == 7.5 ? 28 : 7.5;

    response.status(204).send();
});

/** Tariff price (pence per kWh) at a given time, from the half-hourly tariff structure. */
const priceAt = (unixSeconds) => {
    const date = new Date(unixSeconds * 1000);
    const hour = date.getHours();
    const minute = date.getMinutes();
    return tariffStructure.find(t => t.hour === hour && minute >= t.startMinute && minute <= t.endMinute).price;
};

const OPTIMISATION_STEP_SECONDS = 60;

/** Cost in pence of running a forecast starting at the given time, evaluated minute by minute. */
const costOfForecast = (slots, startTime) => {
    let cost = 0;
    let offset = 0;

    for (const slot of slots) {
        const powerInKiloWatt = Number(slot.nominalPower ?? 0) / 1000000; // Matter uses milliwatts

        for (let t = 0; t < slot.defaultDuration; t += OPTIMISATION_STEP_SECONDS) {
            const seconds = Math.min(OPTIMISATION_STEP_SECONDS, slot.defaultDuration - t);
            cost += powerInKiloWatt * (seconds / 3600) * priceAt(startTime + offset + t);
        }

        offset += slot.defaultDuration;
    }

    return cost;
};

/**
 * Picks the cheapest start for one DEM endpoint within the window the device offers and requests it.
 * Returns a summary describing what was done.
 */
const optimiseEndpoint = async (entry) => {
    const summary = { nodeId: entry.nodeId, endpointId: entry.endpointId, esaType: entry.esaType };

    if (!entry.features?.startTimeAdjustment) {
        return { ...summary, action: "skipped", reason: "Start time can't be adjusted" };
    }

    // Local optimisation is only allowed when the user hasn't opted out of it.
    const { NoOptOut, GridOptOut } = DeviceEnergyManagement.OptOutState;
    if (entry.optOutState !== NoOptOut && entry.optOutState !== GridOptOut) {
        return { ...summary, action: "skipped", reason: "Opted out of local optimisation" };
    }

    const forecast = entry.forecast;
    if (!forecast || forecast.earliestStartTime === undefined || forecast.latestEndTime === undefined) {
        return { ...summary, action: "skipped", reason: "No forecast with a start window" };
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const duration = forecast.endTime - forecast.startTime;
    // A null earliestStartTime means "now". Candidates are aligned to whole minutes.
    const earliestAllowed = Math.max(currentTime + OPTIMISATION_STEP_SECONDS, forecast.earliestStartTime ?? currentTime);
    const earliestStart = Math.ceil(earliestAllowed / OPTIMISATION_STEP_SECONDS) * OPTIMISATION_STEP_SECONDS;
    const latestStart = forecast.latestEndTime - duration;

    if (latestStart < earliestStart) {
        return { ...summary, action: "skipped", reason: "No flexibility in the start window" };
    }

    let best = { startTime: forecast.startTime, cost: costOfForecast(forecast.slots, forecast.startTime) };
    const currentCost = best.cost;

    for (let startTime = earliestStart; startTime <= latestStart; startTime += OPTIMISATION_STEP_SECONDS) {
        const cost = costOfForecast(forecast.slots, startTime);
        if (cost < best.cost - 0.0001) {
            best = { startTime, cost };
        }
    }

    if (best.startTime === forecast.startTime) {
        return { ...summary, action: "unchanged", startTime: forecast.startTime, cost: currentCost };
    }

    // matter.js takes epoch-s values as Unix seconds and converts them to the Matter epoch on the wire.
    await entry.client.startTimeAdjustRequest({
        requestedStartTime: best.startTime,
        cause: DeviceEnergyManagement.AdjustmentCause.LocalOptimization
    });

    // The device publishes its adjusted forecast, which reaches the UI through the forecast listener.
    return { ...summary, action: "moved", from: forecast.startTime, startTime: best.startTime, previousCost: currentCost, cost: best.cost };
};

app.post("/optimise", async (request, response) => {

    const results = [];

    for (const entry of demEndpoints.values()) {
        try {
            results.push(await optimiseEndpoint(entry));
        } catch (error) {
            console.error(`Optimisation failed for ${demKey(entry.nodeId, entry.endpointId)}`, error);
            results.push({ nodeId: entry.nodeId, endpointId: entry.endpointId, action: "failed", reason: String(error) });
        }
    }

    console.log({ results });

    response.send(results);
});
