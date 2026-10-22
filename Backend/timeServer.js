import { DeviceTypeId, ServerNode, Time, VendorId } from "@matter/main";
import { TimeSynchronizationServer } from "@matter/main/behaviors/time-synchronization";
import { TimeSynchronization } from "@matter/main/clusters";
import { Status, StatusResponseError } from "@matter/main/types";

/*
 * A small Matter node that serves the Time Synchronization cluster from this
 * machine's clock, so commissioned devices can use it as a trusted time source.
 */

export const TIME_SERVER_PORT = Number(process.env.TIME_SERVER_PORT || 5560);
export const TIME_SERVER_PASSCODE = 20202021;
export const TIME_SERVER_DISCRIMINATOR = 3841;

// Matter times are microseconds since 2000-01-01 UTC.
//
const MATTER_EPOCH_OFFSET_MS = 946684800000;

export const matterUtcNow = () => BigInt(Date.now() - MATTER_EPOCH_OFFSET_MS) * 1000n;

let clockTimer;

class SystemClockTimeSynchronizationServer extends TimeSynchronizationServer {
    initialize() {
        this.state.utcTime = matterUtcNow();
        this.state.granularity = TimeSynchronization.Granularity.SecondsGranularity;

        // UTCTime doesn't report changes, so keeping it current is cheap.
        //
        clockTimer = Time.getPeriodicTimer("UTC time update", 1000, this.callback(this.#tick, { lock: true }));
        clockTimer.start();
    }

    #tick() {
        this.state.utcTime = matterUtcNow();
    }

    // The time comes from this machine's clock, so don't let anyone set it.
    //
    setUtcTime() {
        throw new StatusResponseError("The time server uses the system clock", Status.Failure, TimeSynchronization.StatusCode.TimeNotAccepted);
    }

    async [Symbol.asyncDispose]() {
        clockTimer?.stop();
        await super[Symbol.asyncDispose]?.();
    }
}

export async function startTimeServer() {

    const server = await ServerNode.create(ServerNode.RootEndpoint.with(SystemClockTimeSynchronizationServer), {
        id: "TimeServer",
        network: { port: TIME_SERVER_PORT },
        commissioning: {
            passcode: TIME_SERVER_PASSCODE,
            discriminator: TIME_SERVER_DISCRIMINATOR,
        },
        productDescription: {
            name: "Energy Manager Time Server",

            // The node has no device endpoints, but matter.js needs a device
            // type to advertise it for commissioning.
            //
            deviceType: DeviceTypeId(0x0016), // Root Node
        },
        basicInformation: {
            vendorName: "matter.js",
            vendorId: VendorId(0xfff1),
            productName: "Energy Manager Time Server",
            productId: 0x8001,
            nodeLabel: "Energy Manager Time Server",
            serialNumber: "energy-manager-time-server",
        },
    });

    await server.start();

    return server;
}
