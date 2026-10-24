// Mirrors matter.js's NodeStates. It's copied rather than imported because
// importing matter.js here pulls the whole library into the browser bundle.
//
export enum NodeStates {
    Connected = 0,
    Disconnected = 1,
    Reconnecting = 2,
    WaitingForDeviceDiscovery = 3
}

export type Slot = {
    nominalPower: number,
    defaultDuration: number
}

export type Forecast = {
    startTime: number,
    endTime: number,
    slots: Slot[]
}

type Device = {
    id: string,
    state?: NodeStates,
    manufacturer?: string,
    forecast?: Forecast,
    deviceTypes: number[],
    supportsTrustedTimeSource?: boolean,
    usesEnergyManagerTime?: boolean
}

export default Device;