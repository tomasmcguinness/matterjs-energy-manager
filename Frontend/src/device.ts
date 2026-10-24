import { NodeStates, PairedNode } from "@project-chip/matter.js/device"

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
    state?: string,
    manufacturer?: string,
    forecast?: Forecast,
    deviceTypes: number[],
    supportsTrustedTimeSource?: boolean,
    usesEnergyManagerTime?: boolean
}

export default Device;