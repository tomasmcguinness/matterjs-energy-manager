import { Environment, StorageService } from "@matter/main";
import { CommissioningController } from "@project-chip/matter.js";
import { ManualPairingCodeCodec, QrPairingCodeCodec } from "@matter/main/types";
import express from "express";
import http from "http"
import { Server } from "socket.io";
import cors from "cors";
import { Diagnostic, NodeId, EndpointNumber } from "@matter/main";
import { GeneralCommissioning, OperationalState } from "@matter/main/clusters";
import { DeviceEnergyManagement, DescriptorCluster } from "@matter/main/clusters";
import { AccessControl, TimeSynchronization } from "@matter/main/clusters";
import { NodeStates } from "@project-chip/matter.js/device";
import { startTimeServer, matterUtcNow, TIME_SERVER_PORT, TIME_SERVER_PASSCODE, TIME_SERVER_DISCRIMINATOR } from "./timeServer.js";

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: true, // Allow the frontend from any host on the network.
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

const storage = await storageService.open("controller");

const controllerStorage = storage.createContext("data");

await controllerStorage.set("fabriclabel", adminFabricLabel);

console.log(`Starting controller...`);

await commissioningController.start();

/*
 * Stand up the time server and make sure it's on our fabric, so devices can
 * use it as their trusted time source.
 */
const timeServerStorage = storage.createContext("timeServer");

let timeServerNodeId = null;
let timeServerReady = false;

const isTimeServer = (nodeId) => timeServerNodeId !== null && nodeId.toString() === timeServerNodeId.toString();

// Resolve once the node is connected, so its clusters can be used.
//
const waitForConnection = (node, timeoutSeconds = 60) => new Promise((resolve, reject) => {
    if (node.isConnected) {
        resolve();
        return;
    }

    const timeout = setTimeout(() => {
        node.events.stateChanged.off(onStateChanged);
        reject(new Error(`Node ${node.nodeId} did not connect within ${timeoutSeconds}s`));
    }, timeoutSeconds * 1000);

    const onStateChanged = (state) => {
        if (state === NodeStates.Connected) {
            clearTimeout(timeout);
            node.events.stateChanged.off(onStateChanged);
            resolve();
        }
    };

    node.events.stateChanged.on(onStateChanged);
    node.connect();
});

// Let any node on our fabric read the time server's Time Synchronization
// cluster. Commissioning only grants access to this controller.
//
const grantTimeServerAccess = async (nodeId) => {

    const node = await commissioningController.getNode(nodeId);

    await waitForConnection(node);

    const accessControl = node.getRootClusterClient(AccessControl.Cluster);

    const acl = await accessControl.getAclAttribute(true);

    const isGranted = acl.some(entry =>
        entry.privilege === AccessControl.AccessControlEntryPrivilege.View &&
        entry.authMode === AccessControl.AccessControlEntryAuthMode.Case &&
        entry.subjects === null &&
        entry.targets?.some(target => target.cluster === TimeSynchronization.Cluster.id));

    if (isGranted) {
        return;
    }

    console.log('Granting fabric access to the time server');

    await accessControl.setAclAttribute([...acl, {
        fabricIndex: acl[0].fabricIndex,
        privilege: AccessControl.AccessControlEntryPrivilege.View,
        authMode: AccessControl.AccessControlEntryAuthMode.Case,
        subjects: null,
        targets: [{ cluster: TimeSynchronization.Cluster.id, endpoint: EndpointNumber(0), deviceType: null }],
    }]);
}

try {
    const timeServer = await startTimeServer();

    if (await timeServerStorage.has("nodeId")) {
        timeServerNodeId = NodeId(BigInt(await timeServerStorage.get("nodeId")));
    }

    if (timeServerNodeId === null || !commissioningController.isNodeCommissioned(timeServerNodeId)) {

        if (timeServer.lifecycle.isCommissioned) {
            throw new Error('The time server is commissioned to another fabric. Delete its storage to reset it.');
        }

        console.log('Commissioning the time server...');

        timeServerNodeId = await commissioningController.commissionNode({
            commissioning: {
                regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
                regulatoryCountryCode: "XX",
            },
            discovery: {
                identifierData: { longDiscriminator: TIME_SERVER_DISCRIMINATOR },
                knownAddress: { type: "udp", ip: "127.0.0.1", port: TIME_SERVER_PORT },
            },
            passcode: TIME_SERVER_PASSCODE,
        });

        await timeServerStorage.set("nodeId", timeServerNodeId.toString());

        console.log(`Time server commissioned with nodeId ${timeServerNodeId}`);
    }

    await grantTimeServerAccess(timeServerNodeId);

    timeServerReady = true;
} catch (error) {
    console.error('Time server unavailable. Devices cannot use the energy manager as a trusted time source.', error);
}

let nodes = await commissioningController.getCommissionedNodes();

// Matter times are seconds since 2000-01-01 UTC. The frontend works in Unix
// seconds, so forecasts are converted at the API boundary.
//
const MATTER_EPOCH_OFFSET_SECONDS = 946684800;

const matterToUnix = (seconds) => seconds == null ? seconds : seconds + MATTER_EPOCH_OFFSET_SECONDS;
const unixToMatter = (seconds) => seconds - MATTER_EPOCH_OFFSET_SECONDS;

function forecastToUnix(forecast) {
    if (!forecast) {
        return forecast;
    }

    return {
        ...forecast,
        startTime: matterToUnix(forecast.startTime),
        endTime: matterToUnix(forecast.endTime),
        earliestStartTime: matterToUnix(forecast.earliestStartTime),
        latestEndTime: matterToUnix(forecast.latestEndTime),
    };
}

// Devices can expose the DeviceEnergyManagement cluster on any endpoint
// (e.g. endpoint 2 on composed devices), so search the endpoint tree for it.
//
function findDeviceEnergyManagement(node) {
    const search = (endpoints) => {
        for (const endpoint of endpoints) {
            const client = endpoint.getClusterClient(DeviceEnergyManagement.Complete);

            if (client) {
                return client;
            }

            const found = search(endpoint.getChildEndpoints());

            if (found) {
                return found;
            }
        }
    };

    return search(node.getDevices());
}

// The forecastId last optimised for each node, so a forecast is only
// optimised once rather than again when the device reports the adjusted one.
//
const optimisedForecastIds = new Map();

// Optimise a newly arrived forecast, if the device allows it.
//
async function autoOptimise(node, forecast) {

    if (!forecast || !forecast.slots) {
        return;
    }

    const nodeKey = node.nodeId.toString();

    // Our own adjustments come back as LocalOptimization updates.
    //
    if (forecast.forecastUpdateReason === DeviceEnergyManagement.ForecastUpdateReason.LocalOptimization) {
        console.log(`Forecast ${forecast.forecastId} for node ${nodeKey} is the result of a local optimisation. Not optimising.`);
        return;
    }

    if (optimisedForecastIds.get(nodeKey) === forecast.forecastId) {
        console.log(`Forecast ${forecast.forecastId} for node ${nodeKey} has already been optimised.`);
        return;
    }

    const deviceEnergyManagement = findDeviceEnergyManagement(node);

    if (!deviceEnergyManagement) {
        return;
    }

    // Optimisation moves the start time, so the device must support that.
    //
    if (!deviceEnergyManagement.supportedFeatures.startTimeAdjustment) {
        console.log(`Node ${nodeKey} does not support start time adjustment. Not optimising.`);
        return;
    }

    // Only optimise when the user hasn't opted out of local optimisation.
    //
    const optOutState = await deviceEnergyManagement.getOptOutStateAttribute();

    if (optOutState !== DeviceEnergyManagement.OptOutState.NoOptOut && optOutState !== DeviceEnergyManagement.OptOutState.GridOptOut) {
        console.log(`Node ${nodeKey} has opted out of local optimisation (optOutState ${optOutState}). Not optimising.`);
        return;
    }

    optimisedForecastIds.set(nodeKey, forecast.forecastId);

    console.log(`Automatically optimising forecast ${forecast.forecastId} for node ${nodeKey}`);

    await optimiseForecast(deviceEnergyManagement, forecast);
}

nodes.forEach(async (nodeId) => {
    if (isTimeServer(nodeId)) {
        return;
    }

    const node = await commissioningController.getNode(nodeId);

    node.events.attributeChanged.on(({ path: { nodeId, clusterId, endpointId, attributeName }, value }) => {

        console.log({ clusterId });

        if (clusterId === OperationalState.id) {
            io.emit("operationalState", value);
        }

        if (clusterId === 0x98) {
            console.log({ attributeName });

            if (attributeName === "optOutState") {
                io.emit("optOutState", value);
            }

            if (attributeName === "forecast") {
                autoOptimise(node, value).catch(error => console.error('Automatic optimisation failed', error));
            }
        }

        console.log(`attributeChangedCallback ${nodeId}: Attribute ${endpointId}/${clusterId}/${attributeName} changed to ${Diagnostic.json(value)}`);
    });

    if (!node.isConnected) {
        node.connect();
    }

    node.events.stateChanged.on(async (info) => {
        switch (info) {
            case NodeStates.Connected:
                console.log(`state changed: Node ${nodeId} connected!`);

                {
                    console.log('Attempting to subscribe to the forecast');

                    const deviceEnergyManagement = findDeviceEnergyManagement(node);

                    if (deviceEnergyManagement) {

                        deviceEnergyManagement.addForecastAttributeListener(value => {
                            console.log("Forecast Updated", value);

                            if (value) {
                                io.emit("forecast", forecastToUnix(value));
                            } else {
                                io.emit("forecast", null);
                            }
                        });

                    } else {
                        console.error('No cluster client available for the DeviceEnergyManager...');
                    }
                }

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
});

app.get("/devices", async (request, response) => {

    const nodeDetails = commissioningController.getCommissionedNodes().filter(nodeId => !isTimeServer(nodeId));

    let mapResult = nodeDetails.map(async (nodeId) => {

        const node = await commissioningController.getNode(nodeId);

        var endpoint = node.getRootEndpoint();

        const descriptorCluster = endpoint.getClusterClient(DescriptorCluster);

        const partsList = await descriptorCluster.getPartsListAttribute();

        var deviceTypes = [];

        for (const endpointId of partsList) {

            const endpoint = node.getDeviceById(endpointId);

            // Get the Descriptor cluster client
            const descriptorCluster = endpoint.getClusterClient(DescriptorCluster);

            // Retrieve the device type list
            const deviceTypeList = await descriptorCluster.getDeviceTypeListAttribute();

            for (const deviceType of deviceTypeList) {
                deviceTypes.push(deviceType.deviceType)
            }
        }

        const timeSynchronization = node.getRootClusterClient(TimeSynchronization.Complete);

        const supportsTrustedTimeSource = timeSynchronization?.supportedFeatures.timeSyncClient === true;

        let usesEnergyManagerTime = false;

        if (supportsTrustedTimeSource && timeServerNodeId !== null) {
            const trustedTimeSource = await timeSynchronization.getTrustedTimeSourceAttribute();
            usesEnergyManagerTime = trustedTimeSource?.nodeId?.toString() === timeServerNodeId.toString();
        }

        return {
            id: nodeId.toString(), state: node.state,
            manufacturer: node?.basicInformation?.manufacturerName?.toString(),
            deviceTypes,
            supportsTrustedTimeSource,
            usesEnergyManagerTime,
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

    response.send({ id: nodeId.toString() });
});

app.get("/devices/:nodeId", async (request, response) => {

    const { nodeId } = request.params;

    const node = await commissioningController.getNode(NodeId(nodeId));

    response.send({
        id: nodeId.toString(),
        state: node.state,
        manufacturer: node?.basicInformation?.manufacturerName?.toString(),
    });
});

// Make the energy manager's time server the device's trusted time source,
// and set its clock straight away rather than waiting for it to sync.
//
app.post("/devices/:nodeId/trusted-time-source", async (request, response) => {

    const { nodeId } = request.params;

    if (!timeServerReady) {
        response.status(503).send({ error: "The time server is not available. Check the backend log." });
        return;
    }

    const node = await commissioningController.getNode(NodeId(BigInt(nodeId)));

    const timeSynchronization = node.getRootClusterClient(TimeSynchronization.Complete);

    if (!timeSynchronization?.supportedFeatures.timeSyncClient) {
        response.status(409).send({ error: "This device cannot use a trusted time source." });
        return;
    }

    console.log(`Setting the trusted time source of node ${nodeId} to the time server (node ${timeServerNodeId})`);

    await timeSynchronization.setTrustedTimeSource({
        trustedTimeSource: { nodeId: timeServerNodeId, endpoint: EndpointNumber(0) },
    });

    // The device may refuse the time if it already has a better source.
    //
    let utcTimeSet = true;

    try {
        await timeSynchronization.setUtcTime({
            utcTime: matterUtcNow(),
            granularity: TimeSynchronization.Granularity.SecondsGranularity,
        });
    } catch (error) {
        utcTimeSet = false;
        console.log(`Node ${nodeId} did not accept the UTC time`, error.message);
    }

    response.send({ trustedTimeSource: timeServerNodeId.toString(), utcTimeSet });
});

app.get("/devices/:nodeId/forecast", async (request, response) => {

    const { nodeId } = request.params;

    console.log(`Fetching forecast for device ${nodeId}`);

    let node = await commissioningController.getNode(NodeId(nodeId));

    var forecast = null;

    const deviceEnergyManagement = findDeviceEnergyManagement(node);

    if (deviceEnergyManagement) {
        forecast = await deviceEnergyManagement.getForecastAttribute();
    }

    if (forecast) {
        console.log({ forecast });

        if (forecast.startTime === 0) {
            response.status(204).send();
        } else {
            response.send(forecastToUnix(forecast));
        }
    } else {
        console.log('No forecast available for device. Return 204');
        response.status(204).send();
    }
});

app.delete("/devices/:nodeId", async (request, response) => {

    const { nodeId } = request.params;

    let node = await commissioningController.getNode(NodeId(nodeId));

    await node.decommission();

    response.status(204).send();
});

/*
 * Matter Controller Companion (MCC) iOS app API.
 * See https://github.com/tomasmcguinness/matter-controller-companion-app#controller-api
 */
const companionStorage = storage.createContext("companion");

const COMMISSIONING_TIMEOUT_MS = 85 * 1000; // The app gives up after 90 seconds.

// Node ids are 64-bit, so they are sent as decimal strings, which the app accepts.
//
const getNodeNames = async () => await companionStorage.get("nodeNames", {});

app.get("/api/companion/info", async (request, response) => {
    response.send({ name: "Matter Energy Manager" });
});

app.get("/api/companion/nodes", async (request, response) => {

    const nodeNames = await getNodeNames();

    const nodeIds = commissioningController.getCommissionedNodes();

    const nodes = await Promise.all(nodeIds.map(async (nodeId) => {

        const node = await commissioningController.getNode(nodeId);

        const basicInformation = node.basicInformation ?? {};

        // Flatten the endpoint tree, so composed devices list all their endpoints.
        //
        const endpoints = [];

        const addEndpoint = (endpoint) => {
            const deviceTypes = endpoint.getDeviceTypes();

            endpoints.push({
                endpointId: endpoint.number,
                endpointName: deviceTypes[0]?.name ?? null,
                deviceTypes: deviceTypes.map(deviceType => deviceType.code),
            });

            endpoint.getChildEndpoints().forEach(addEndpoint);
        };

        node.getDevices().forEach(addEndpoint);

        return {
            nodeId: nodeId.toString(),
            isIcd: node.deviceInformation?.isIntermittentlyConnected ?? false,
            vendorName: basicInformation.vendorName?.toString() ?? null,
            productName: basicInformation.productName?.toString() ?? null,
            nodeName: nodeNames[nodeId.toString()] ?? (basicInformation.nodeLabel || null),
            hasSubscription: node.state === NodeStates.Connected,
            endpoints,
        };
    }));

    response.send(nodes);
});

app.post("/api/companion/nodes", async (request, response) => {

    const { setupCode } = request.body ?? {};

    if (!setupCode) {
        response.status(400).send("setupCode is required");
        return;
    }

    let passcode, identifierData;

    try {
        if (setupCode.startsWith("MT:")) {
            const qrCode = QrPairingCodeCodec.decode(setupCode)[0];
            passcode = qrCode.passcode;
            identifierData = { longDiscriminator: qrCode.discriminator };
        } else {
            const manualCode = ManualPairingCodeCodec.decode(setupCode);
            passcode = manualCode.passcode;
            identifierData = { shortDiscriminator: manualCode.shortDiscriminator };
        }
    } catch (error) {
        response.status(400).send(`Invalid setup code: ${error.message}`);
        return;
    }

    const options = {
        commissioning: {
            regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
            regulatoryCountryCode: "XX",
        },
        discovery: { identifierData },
        passcode,
    };

    console.log(`Companion commissioning ... ${Diagnostic.json(options)}`);

    let timeout;

    const timedOut = new Promise((resolve) => {
        timeout = setTimeout(() => resolve(undefined), COMMISSIONING_TIMEOUT_MS);
    });

    try {
        const nodeId = await Promise.race([commissioningController.commissionNode(options), timedOut]);

        if (nodeId === undefined) {
            response.status(504).send("Commissioning timed out");
            return;
        }

        console.log(`Companion commissioning successfully done with nodeId ${nodeId}`);

        response.send({ nodeId: nodeId.toString() });
    } catch (error) {
        console.error("Companion commissioning failed", error);
        response.status(500).send(`Commissioning failed: ${error.message}`);
    } finally {
        clearTimeout(timeout);
    }
});

app.put("/api/companion/nodes/:nodeId/update", async (request, response) => {

    const { nodeId } = request.params;
    const { name } = request.body ?? {};

    if (typeof name !== "string") {
        response.status(400).send("name is required");
        return;
    }

    const nodeNames = await getNodeNames();
    nodeNames[nodeId] = name;
    await companionStorage.set("nodeNames", nodeNames);

    response.status(204).send();
});

app.delete("/api/companion/nodes/:nodeId", async (request, response) => {

    const { nodeId } = request.params;

    try {
        // Removes the node locally even if the device can't be reached to decommission it.
        //
        await commissioningController.removeNode(NodeId(BigInt(nodeId)), true);
    } catch (error) {
        console.error(`Failed to remove node ${nodeId}`, error);
        response.status(500).send(`Failed to remove node: ${error.message}`);
        return;
    }

    const nodeNames = await getNodeNames();
    delete nodeNames[nodeId];
    await companionStorage.set("nodeNames", nodeNames);

    response.status(204).send();
});

app.put("/api/companion/notifications", async (request, response) => {

    const { relayUrl, username, password, deviceToken, environment } = request.body ?? {};

    if (!relayUrl || !username || !password || !deviceToken || !environment) {
        response.status(400).send("relayUrl, username, password, deviceToken and environment are required");
        return;
    }

    await companionStorage.set("notifications", { relayUrl, username, password, deviceToken, environment });

    response.status(204).send();
});

app.delete("/api/companion/notifications", async (request, response) => {

    await companionStorage.delete("notifications");

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

// Changes made to the tariff are saved, so they survive a restart.
//
const tariffStorage = storage.createContext("tariff");

if (await tariffStorage.has("structure")) {
    tariffStructure = await tariffStorage.get("structure");
}

const generateTariff = (currentTime) => {

    let tariffSlots = [];

    let currentDate = new Date();

    tariffStructure.forEach(element => {
        let startDate = currentDate.setHours(element.hour, element.startMinute, 0, 0);

        // The structure ends with midnight to close off the day, which
        // belongs to tomorrow rather than the start of today.
        //
        if (tariffSlots.length > 0 && startDate < tariffSlots[tariffSlots.length - 1].startDate) {
            startDate = currentDate.setDate(currentDate.getDate() + 1);
        }

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

    await tariffStorage.set("structure", tariffStructure);

    response.status(204).send();
});

// Find the first commissioned node that supports DeviceEnergyManagement.
//
const getDeviceEnergyManagement = async () => {

    const nodeDetails = await commissioningController.getCommissionedNodes();

    for (const nodeId of nodeDetails) {

        const node = await commissioningController.getNode(nodeId);

        const deviceEnergyManagement = findDeviceEnergyManagement(node);

        if (deviceEnergyManagement) {
            return deviceEnergyManagement;
        }
    }

    return null;
}

// The price, in pence per kWh, at a Unix time. The tariff repeats daily, so
// look it up by the local time of day.
//
const priceAt = (unixSeconds) => {
    const date = new Date(unixSeconds * 1000);
    const hour = date.getHours();
    const minute = date.getMinutes();

    const slot = tariffStructure.find(element => element.hour === hour && minute >= element.startMinute && minute <= element.endMinute);

    return slot.price;
}

// The cost, in pence, of running the forecast's slots starting at startTime.
// Prices change on the half hour, so each slot is split at those boundaries.
// (This assumes the local UTC offset is a whole number of half hours.)
//
const costOfRunningAt = (forecast, startTime) => {

    let cost = 0;
    let time = startTime;

    for (const slot of forecast.slots) {

        const powerInKiloWatts = slot.nominalPower / 1000000; // Matter uses milliwatts
        const slotEnd = time + slot.defaultDuration;

        while (time < slotEnd) {
            const next = Math.min(slotEnd, (Math.floor(time / 1800) + 1) * 1800);
            cost += powerInKiloWatts * ((next - time) / 3600) * priceAt(time);
            time = next;
        }
    }

    return cost;
}

// Find the cheapest start time for a forecast (in Unix time), within the
// window the device allows, checking each minute.
//
const findCheapestStartTime = (forecast) => {

    const duration = forecast.slots.reduce((total, slot) => total + slot.defaultDuration, 0);

    const now = Math.floor(Date.now() / 1000);

    const maximumDelayInSeconds = 12 * 60 * 60;

    const earliestStart = Math.max(now, forecast.earliestStartTime ?? forecast.startTime);
    const latestStart = forecast.latestEndTime != null ? forecast.latestEndTime - duration : earliestStart + maximumDelayInSeconds;

    let simulationOutcomes = [];
    let cheapest = null;

    for (let startTime = earliestStart; startTime <= latestStart; startTime += 60) {

        // Round to a hundredth of a penny so floating point noise doesn't
        // count as a saving.
        //
        const totalCost = Math.round(costOfRunningAt(forecast, startTime) * 100) / 100;

        simulationOutcomes.push({ delay: startTime - earliestStart, totalCost });

        // Strictly cheaper, so ties go to the earliest start.
        //
        if (cheapest === null || totalCost < cheapest.totalCost) {
            cheapest = { startTime, totalCost };
        }
    }

    return { cheapest, simulationOutcomes };
}

// Work out the cheapest start time for the device's forecast and ask the
// device to move to it.
//
const optimiseForecast = async (deviceEnergyManagement, matterForecast) => {

    const forecast = forecastToUnix(matterForecast);

    const { cheapest, simulationOutcomes } = findCheapestStartTime(forecast);

    console.log({ cheapest });

    if (cheapest === null) {
        console.log('No start time within the forecast window. Leaving forecast unchanged.');
        return simulationOutcomes;
    }

    if (cheapest.startTime === forecast.startTime) {
        console.log('Forecast already starts at the cheapest time.');
        return simulationOutcomes;
    }

    await deviceEnergyManagement.startTimeAdjustRequest({
        requestedStartTime: unixToMatter(cheapest.startTime),
        cause: DeviceEnergyManagement.AdjustmentCause.LocalOptimization
    });

    io.emit("forecast", {
        ...forecast,
        startTime: cheapest.startTime,
        endTime: cheapest.startTime + (forecast.endTime - forecast.startTime),
    });

    return simulationOutcomes;
}

app.post("/optimise", async (request, response) => {

    const deviceEnergyManagement = await getDeviceEnergyManagement();

    var forecast = deviceEnergyManagement ? await deviceEnergyManagement.getForecastAttribute() : null;

    if (!forecast || !forecast.slots) {
        console.log('No forecast available to optimise. Return 204');
        response.status(204).send();
        return;
    }

    const simulationOutcomes = await optimiseForecast(deviceEnergyManagement, forecast);

    response.send(simulationOutcomes);
});
