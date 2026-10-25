import { FormaldehydeConcentrationMeasurement } from "@matter/main/model"
import { NodeStates, PairedNode } from "@project-chip/matter.js/device"

export type Slot = {
    nominalPower: number,
    minPower?: number,
    maxPower?: number,
    defaultDuration: number
}

// Times are Unix seconds; matter.js converts them from the Matter epoch.
export type Forecast = {
    forecastId?: number,
    activeSlotNumber?: number | null,
    startTime: number,
    endTime: number,
    earliestStartTime?: number | null,
    latestEndTime?: number,
    forecastUpdateReason?: number,
    slots: Slot[]
}

// A Device Energy Management endpoint discovered on a node.
export type DemEndpoint = {
    nodeId: string,
    endpointId: number,
    deviceTypes: number[],
    esaType: number,
    esaCanGenerate: boolean,
    esaState: number,
    features: Record<string, boolean>,
    optOutState?: number,
    forecast: Forecast | null
}

type Device = {
    id: string,
    state?: NodeStates,
    manufacturer?: string,
    productName?: string,
    deviceTypes?: number[],
    forecast?: Forecast
}

export default Device;