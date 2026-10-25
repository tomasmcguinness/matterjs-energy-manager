export const deviceTypeNames: Record<number, string> = {
    17: "Power Source",
    23: "Solar Power",
    24: "Battery Storage",
    115: "Laundry Washer",
    117: "Dishwasher",
    769: "Thermostat",
    770: "Temperature Sensor",
    777: "Heat Pump",
    1292: "EVSE",
    1293: "Device Energy Manager",
    1296: "Electrical Sensor",
};

// DeviceEnergyManagement.EsaType
export const esaTypeNames: Record<number, string> = {
    0: "EVSE",
    1: "Space heating",
    2: "Water heating",
    3: "Space cooling",
    4: "Space heating/cooling",
    5: "Battery storage",
    6: "Solar PV",
    7: "Fridge/freezer",
    8: "Washing machine",
    9: "Dishwasher",
    10: "Cooking",
    11: "Home water pump",
    12: "Irrigation pump",
    13: "Pool pump",
    255: "Other",
};

// DeviceEnergyManagement.OptOutState
export const optOutStateNames: Record<number, string> = {
    0: "Opted In",
    1: "Local Opt Out",
    2: "Grid Opt Out",
    3: "Opted Out",
};
